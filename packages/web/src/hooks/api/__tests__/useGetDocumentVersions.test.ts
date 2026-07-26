import { renderHook, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { vi } from "vitest";

const { getVersions } = vi.hoisted(() => ({
  getVersions: vi.fn(),
}));

vi.mock("@/lib/eden", () => ({
  api: {
    core: {
      orgs: () => ({
        documents: () => ({
          versions: {
            get: getVersions,
          },
        }),
      }),
    },
  },
}));

import { useGetDocumentVersions } from "../useGetDocumentVersions";

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}

beforeEach(() => {
  getVersions.mockReset();
});

describe("useGetDocumentVersions", () => {
  it("fetches a document's version history", async () => {
    getVersions.mockResolvedValue({
      status: 200,
      data: [
        {
          id: "v-1",
          versionNumber: 1,
          originalFilename: "cert.pdf",
          mimeType: "application/pdf",
          sizeBytes: 1024,
          sha256: "abc123",
          uploadedBy: "u-1",
          uploadedAt: "2026-07-01T00:00:00.000Z",
        },
      ],
    });

    const { result } = renderHook(
      () => useGetDocumentVersions("org-1", "doc-1", true),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(getVersions).toHaveBeenCalled();
    expect(result.current.versions).toHaveLength(1);
    expect(result.current.isError).toBe(false);
  });

  it("stays disabled when enabled is false", () => {
    const { result } = renderHook(
      () => useGetDocumentVersions("org-1", "doc-1", false),
      { wrapper: createWrapper() },
    );

    expect(getVersions).not.toHaveBeenCalled();
    expect(result.current.status).toBe("pending");
  });

  it("stays disabled when documentId is undefined", () => {
    const { result } = renderHook(
      () => useGetDocumentVersions("org-1", undefined, true),
      { wrapper: createWrapper() },
    );

    expect(getVersions).not.toHaveBeenCalled();
    expect(result.current.status).toBe("pending");
  });

  it("treats a non-200 response as an error without versions", async () => {
    getVersions.mockResolvedValue({
      status: 404,
      data: null,
      error: { status: 404, value: { ok: false, reason: "not_found" } },
    });

    const { result } = renderHook(
      () => useGetDocumentVersions("org-1", "doc-1", true),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(result.current.versions).toBeUndefined();
    expect(result.current.isError).toBe(true);
  });
});
