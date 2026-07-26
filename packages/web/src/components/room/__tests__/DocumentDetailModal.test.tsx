import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { vi } from "vitest";
import type { DocumentDTO } from "@ai-data-room/api-utils/schemas/rooms";

import { DocumentDetailModal } from "../DocumentDetailModal";

const { getVersions, getDocument, deleteDocument, restoreDocument } =
  vi.hoisted(() => ({
    getVersions: vi.fn(),
    getDocument: vi.fn(),
    deleteDocument: vi.fn(),
    restoreDocument: vi.fn(),
  }));

vi.mock("@/lib/eden", () => ({
  api: {
    core: {
      orgs: () => ({
        documents: () => ({
          versions: { get: getVersions },
          get: getDocument,
          delete: deleteDocument,
          restore: { post: restoreDocument },
        }),
      }),
    },
  },
}));

// Named `baseDocument`, not `document` — this file must not shadow the
// jsdom global `document` that `fireEvent`/`screen` rely on.
const baseDocument: DocumentDTO = {
  id: "doc-1",
  displayName: "Certificate_of_Incorporation.pdf",
  folder: { kind: "canonical", folder: "01_Company_Overview" },
  currentVersion: {
    id: "v-2",
    versionNumber: 2,
    originalFilename: "cert-v2.pdf",
    mimeType: "application/pdf",
    sizeBytes: 2048,
    sha256: "def456",
    uploadedBy: "u-1",
    uploadedAt: "2026-07-05T00:00:00.000Z",
  },
  state: "active",
  createdAt: "2026-07-01T00:00:00.000Z",
};

const versionList = [
  {
    id: "v-1",
    versionNumber: 1,
    originalFilename: "cert-v1.pdf",
    mimeType: "application/pdf",
    sizeBytes: 1024,
    sha256: "abc123",
    uploadedBy: "u-1",
    uploadedAt: "2026-07-01T00:00:00.000Z",
  },
  {
    id: "v-2",
    versionNumber: 2,
    originalFilename: "cert-v2.pdf",
    mimeType: "application/pdf",
    sizeBytes: 2048,
    sha256: "def456",
    uploadedBy: "u-1",
    uploadedAt: "2026-07-05T00:00:00.000Z",
  },
];

function renderModal(
  overrides: Partial<React.ComponentProps<typeof DocumentDetailModal>> = {},
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const onClose = vi.fn();
  const utils = render(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(DocumentDetailModal, {
        open: true,
        document: baseDocument,
        orgId: "org-1",
        canWrite: true,
        onClose,
        ...overrides,
      }),
    ),
  );
  return { ...utils, onClose };
}

beforeEach(() => {
  getVersions.mockReset();
  getDocument.mockReset();
  deleteDocument.mockReset();
  restoreDocument.mockReset();
  getVersions.mockResolvedValue({ status: 200, data: versionList });
  getDocument.mockResolvedValue({
    status: 200,
    data: {
      document: baseDocument,
      downloadUrl: "https://s3.example.com/doc-1/current",
    },
  });
  deleteDocument.mockResolvedValue({ status: 200, data: { ok: true } });
  restoreDocument.mockResolvedValue({ status: 200, data: { ok: true } });
  vi.spyOn(window, "open").mockImplementation(() => null);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("DocumentDetailModal", () => {
  it("renders nothing when closed", () => {
    renderModal({ open: false });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders nothing when there is no document", () => {
    renderModal({ document: null });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders metadata from the DTO without calling getDocument on open", async () => {
    renderModal();

    expect(screen.getByText("Certificate_of_Incorporation.pdf")).toBeDefined();
    expect(screen.getByText(/v2/)).toBeDefined();
    expect(screen.getByText(/2 KB/)).toBeDefined();

    // Version history loads (a distinct call), but the download endpoint —
    // which audits a `file_downloaded` event server-side on every call —
    // must NOT fire just from the modal being open.
    await waitFor(() => expect(getVersions).toHaveBeenCalled());
    expect(getDocument).not.toHaveBeenCalled();
  });

  it("shows a loading state for version history, then the rows", async () => {
    let resolveVersions!: (value: {
      status: number;
      data: typeof versionList;
    }) => void;
    getVersions.mockReturnValue(
      new Promise((resolve) => {
        resolveVersions = resolve;
      }),
    );

    renderModal();

    expect(screen.getByText("Loading…")).toBeDefined();

    resolveVersions({ status: 200, data: versionList });

    await waitFor(() => expect(screen.getByText("cert-v1.pdf")).toBeDefined());
    expect(screen.getByText("cert-v2.pdf")).toBeDefined();
    expect(screen.getByText(/v2 \(current\)/)).toBeDefined();
  });

  it("shows a distinct error state for version history (never an empty list)", async () => {
    getVersions.mockResolvedValue({
      status: 404,
      data: null,
      error: { status: 404, value: { ok: false, reason: "not_found" } },
    });

    renderModal();

    await waitFor(() =>
      expect(screen.getByText(/Couldn't load version history/i)).toBeDefined(),
    );
    expect(screen.queryByText("Loading…")).toBeNull();
  });

  it("downloads the current version and opens the returned URL", async () => {
    renderModal();

    fireEvent.click(screen.getByRole("button", { name: "Download" }));

    await waitFor(() => expect(getDocument).toHaveBeenCalled());
    expect(getDocument).toHaveBeenCalledWith({
      query: { versionId: undefined },
    });
    await waitFor(() =>
      expect(window.open).toHaveBeenCalledWith(
        "https://s3.example.com/doc-1/current",
        "_blank",
        "noopener,noreferrer",
      ),
    );
  });

  it("passes the versionId for a per-version download", async () => {
    getDocument.mockResolvedValue({
      status: 200,
      data: {
        document: baseDocument,
        downloadUrl: "https://s3.example.com/doc-1/v1",
      },
    });

    renderModal();

    await waitFor(() => expect(screen.getByText("cert-v1.pdf")).toBeDefined());

    const downloadButtons = screen.getAllByRole("button", {
      name: "Download",
    });
    // First is the header's current-version download; per-version rows
    // follow in version-history order (v1, v2).
    fireEvent.click(downloadButtons[1]);

    await waitFor(() =>
      expect(getDocument).toHaveBeenCalledWith({
        query: { versionId: "v-1" },
      }),
    );
    await waitFor(() =>
      expect(window.open).toHaveBeenCalledWith(
        "https://s3.example.com/doc-1/v1",
        "_blank",
        "noopener,noreferrer",
      ),
    );
  });

  it("deletes the document and shows the restore state, then restores back to active", async () => {
    renderModal();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() =>
      expect(screen.getByText(/was deleted and is hidden/i)).toBeDefined(),
    );
    expect(deleteDocument).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Download" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Restore" }));

    // Back to the active view — the Delete button (unique) reappears and
    // the deleted-state copy is gone. (Download also reappears, but by
    // then version-history rows add their own per-version Download
    // buttons too, so it's no longer a unique accessible name.)
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Delete" })).toBeDefined(),
    );
    expect(restoreDocument).toHaveBeenCalled();
    expect(screen.queryByText(/was deleted and is hidden/i)).toBeNull();
  });

  it("shows the retention_expired copy when restore fails past the window", async () => {
    restoreDocument.mockResolvedValue({
      status: 409,
      data: null,
      error: {
        status: 409,
        value: { ok: false, reason: "retention_expired" },
      },
    });

    renderModal();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Restore" })).toBeDefined(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Restore" }));

    await waitFor(() =>
      expect(
        screen.getByText(/30-day restore window has passed/i),
      ).toBeDefined(),
    );
    // Still deleted — the failed restore doesn't flip local state back.
    expect(screen.getByText(/was deleted and is hidden/i)).toBeDefined();
  });

  it("shows a not_found copy when restore fails because the document is gone", async () => {
    restoreDocument.mockResolvedValue({
      status: 404,
      data: null,
      error: { status: 404, value: { ok: false, reason: "not_found" } },
    });

    renderModal();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Restore" })).toBeDefined(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Restore" }));

    await waitFor(() =>
      expect(screen.getByText(/this document no longer exists/i)).toBeDefined(),
    );
  });

  it("shows a generic copy for an invalid_state restore failure", async () => {
    restoreDocument.mockResolvedValue({
      status: 409,
      data: null,
      error: { status: 409, value: { ok: false, reason: "invalid_state" } },
    });

    renderModal();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Restore" })).toBeDefined(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Restore" }));

    await waitFor(() =>
      expect(
        screen.getByText(/something went wrong\. try again\./i),
      ).toBeDefined(),
    );
  });

  it("hides Delete and Restore for a viewer (canWrite=false)", () => {
    renderModal({ canWrite: false });

    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
    expect(screen.getByRole("button", { name: "Download" })).toBeDefined();
  });

  it("closes via Escape and the footer Close button", () => {
    const { onClose } = renderModal();

    fireEvent.keyDown(window.document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);

    // Both the header's icon-only dismiss button and the footer button
    // share the accessible name "Close" (matches the icon-button naming
    // idiom in UploadModal/OpportunityFormModal/ArchiveOpportunityDialog);
    // the footer one renders last in DOM order.
    const closeButtons = screen.getAllByRole("button", { name: "Close" });
    fireEvent.click(closeButtons[closeButtons.length - 1]);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("closes via a scrim click but not a click inside the panel", () => {
    const { onClose } = renderModal();

    fireEvent.mouseDown(screen.getByRole("dialog"));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.mouseDown(screen.getByRole("dialog").parentElement as Element);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not render any AI/checklist/access-control affordances (slice-2 scope guard)", () => {
    renderModal();

    expect(screen.queryByText(/checklist/i)).toBeNull();
    expect(screen.queryByText(/sense.?check/i)).toBeNull();
    expect(screen.queryByText(/redact/i)).toBeNull();
    expect(screen.queryByText(/watermark/i)).toBeNull();
    expect(screen.queryByText(/ocr/i)).toBeNull();
    expect(screen.queryByText(/access control/i)).toBeNull();
  });
});
