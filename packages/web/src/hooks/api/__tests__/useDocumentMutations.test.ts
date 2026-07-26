import { renderHook, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { vi } from "vitest";

const { deleteDocument, restoreDocument, getDocument } = vi.hoisted(() => ({
  deleteDocument: vi.fn(),
  restoreDocument: vi.fn(),
  getDocument: vi.fn(),
}));

vi.mock("@/lib/eden", () => ({
  api: {
    core: {
      orgs: () => ({
        documents: () => ({
          delete: deleteDocument,
          get: getDocument,
          restore: { post: restoreDocument },
        }),
      }),
    },
  },
}));

import {
  DocumentMutationError,
  useRequestDownload,
  useRestoreDocument,
  useSoftDeleteDocument,
} from "../useDocumentMutations";

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
  return { wrapper, invalidateQueries };
}

beforeEach(() => {
  deleteDocument.mockReset();
  restoreDocument.mockReset();
  getDocument.mockReset();
});

describe("useSoftDeleteDocument", () => {
  it("invalidates folderContents on success", async () => {
    deleteDocument.mockResolvedValue({ status: 200, data: { ok: true } });
    const { wrapper, invalidateQueries } = createWrapper();

    const { result } = renderHook(() => useSoftDeleteDocument("org-1"), {
      wrapper,
    });

    result.current.mutate({ id: "doc-1" });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["folderContents", "org-1"],
    });
  });

  it("throws DocumentMutationError with reason invalid_state on a 409", async () => {
    deleteDocument.mockResolvedValue({
      status: 409,
      data: null,
      error: { status: 409, value: { ok: false, reason: "invalid_state" } },
    });
    const { wrapper } = createWrapper();

    const { result } = renderHook(() => useSoftDeleteDocument("org-1"), {
      wrapper,
    });

    result.current.mutate({ id: "doc-1" });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(DocumentMutationError);
    expect((result.current.error as DocumentMutationError).reason).toBe(
      "invalid_state",
    );
  });

  it("throws DocumentMutationError with reason not_found on a 404", async () => {
    deleteDocument.mockResolvedValue({
      status: 404,
      data: null,
      error: { status: 404, value: { ok: false, reason: "not_found" } },
    });
    const { wrapper } = createWrapper();

    const { result } = renderHook(() => useSoftDeleteDocument("org-1"), {
      wrapper,
    });

    result.current.mutate({ id: "doc-1" });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as DocumentMutationError).reason).toBe(
      "not_found",
    );
  });
});

describe("useRestoreDocument", () => {
  it("invalidates folderContents on success", async () => {
    restoreDocument.mockResolvedValue({ status: 200, data: { ok: true } });
    const { wrapper, invalidateQueries } = createWrapper();

    const { result } = renderHook(() => useRestoreDocument("org-1"), {
      wrapper,
    });

    result.current.mutate({ id: "doc-1" });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["folderContents", "org-1"],
    });
  });

  it("throws DocumentMutationError with reason retention_expired on a 409", async () => {
    restoreDocument.mockResolvedValue({
      status: 409,
      data: null,
      error: {
        status: 409,
        value: { ok: false, reason: "retention_expired" },
      },
    });
    const { wrapper } = createWrapper();

    const { result } = renderHook(() => useRestoreDocument("org-1"), {
      wrapper,
    });

    result.current.mutate({ id: "doc-1" });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as DocumentMutationError).reason).toBe(
      "retention_expired",
    );
  });

  it("falls back to reason unknown for an unrecognized error body", async () => {
    restoreDocument.mockResolvedValue({
      status: 500,
      data: { reason: "totally_unexpected" },
    });
    const { wrapper } = createWrapper();

    const { result } = renderHook(() => useRestoreDocument("org-1"), {
      wrapper,
    });

    result.current.mutate({ id: "doc-1" });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as DocumentMutationError).reason).toBe(
      "unknown",
    );
  });
});

describe("useRequestDownload", () => {
  it("returns the downloadUrl on success", async () => {
    getDocument.mockResolvedValue({
      status: 200,
      data: {
        document: { id: "doc-1" },
        downloadUrl: "https://s3.example.com/doc-1",
      },
    });
    const { wrapper } = createWrapper();

    const { result } = renderHook(() => useRequestDownload("org-1"), {
      wrapper,
    });

    result.current.mutate({ id: "doc-1" });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe("https://s3.example.com/doc-1");
    expect(getDocument).toHaveBeenCalledWith({
      query: { versionId: undefined },
    });
  });

  it("passes the versionId through for a specific version's download", async () => {
    getDocument.mockResolvedValue({
      status: 200,
      data: {
        document: { id: "doc-1" },
        downloadUrl: "https://s3.example.com/doc-1/v1",
      },
    });
    const { wrapper } = createWrapper();

    const { result } = renderHook(() => useRequestDownload("org-1"), {
      wrapper,
    });

    result.current.mutate({ id: "doc-1", versionId: "v-1" });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(getDocument).toHaveBeenCalledWith({
      query: { versionId: "v-1" },
    });
  });

  it("throws DocumentMutationError with reason not_found on a 404", async () => {
    getDocument.mockResolvedValue({
      status: 404,
      data: null,
      error: { status: 404, value: { ok: false, reason: "not_found" } },
    });
    const { wrapper } = createWrapper();

    const { result } = renderHook(() => useRequestDownload("org-1"), {
      wrapper,
    });

    result.current.mutate({ id: "doc-1" });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as DocumentMutationError).reason).toBe(
      "not_found",
    );
  });
});
