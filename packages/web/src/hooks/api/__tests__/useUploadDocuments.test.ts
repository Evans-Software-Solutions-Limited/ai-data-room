import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { vi } from "vitest";

const { uploadFileMock } = vi.hoisted(() => ({
  uploadFileMock: vi.fn(),
}));

vi.mock("@/lib/upload/uploadFile", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/upload/uploadFile")
  >("@/lib/upload/uploadFile");
  return {
    ...actual,
    uploadFile: uploadFileMock,
  };
});

import { useUploadDocuments } from "../useUploadDocuments";
import { uploadRegistry } from "@/lib/upload/uploadRegistry";
import { UploadClientError } from "@/lib/upload/uploadFile";

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const Wrapper = ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
  return { Wrapper, queryClient };
}

function clearRegistry() {
  for (const entry of uploadRegistry.getAll()) {
    uploadRegistry.remove(entry.id);
  }
}

function makeFile(name = "Term Sheet.pdf") {
  return new File([new Uint8Array(1024)], name, { type: "application/pdf" });
}

beforeEach(() => {
  uploadFileMock.mockReset();
  clearRegistry();
});

describe("useUploadDocuments", () => {
  it("registers an entry, then on success marks it done and invalidates queries", async () => {
    uploadFileMock.mockResolvedValue({
      documentId: "d1",
      versionId: "v1",
      versionNumber: 1,
    });
    const { Wrapper, queryClient } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(
      () =>
        useUploadDocuments("org-1", {
          kind: "canonical",
          folder: "02_Financials",
        }),
      { wrapper: Wrapper },
    );

    act(() => {
      result.current.startUploads([makeFile()]);
    });

    expect(result.current.uploads).toHaveLength(1);
    expect(result.current.uploads[0].status).toBe("initiating");
    expect(result.current.uploads[0].fileName).toBe("Term Sheet.pdf");
    const id = result.current.uploads[0].id;

    await waitFor(() => {
      expect(uploadRegistry.get(id)?.status).toBe("done");
    });
    expect(uploadRegistry.get(id)?.bytesUploaded).toBe(1024);

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["folderContents", "org-1"],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["room", "org-1"] });
  });

  it("reports upload progress via onProgress into the registry", async () => {
    uploadFileMock.mockImplementation(
      (_params: unknown, deps: { onProgress?: (n: number) => void }) => {
        deps.onProgress?.(512);
        return new Promise(() => {
          // never resolves — just enough to observe the progress update.
        });
      },
    );
    const { Wrapper } = createWrapper();

    const { result } = renderHook(
      () =>
        useUploadDocuments("org-1", {
          kind: "canonical",
          folder: "02_Financials",
        }),
      { wrapper: Wrapper },
    );

    act(() => {
      result.current.startUploads([makeFile()]);
    });

    await waitFor(() => {
      const id = result.current.uploads[0].id;
      expect(uploadRegistry.get(id)?.status).toBe("uploading");
      expect(uploadRegistry.get(id)?.bytesUploaded).toBe(512);
    });
  });

  it("sets registry status to error with friendly copy on a generic UploadClientError", async () => {
    uploadFileMock.mockRejectedValue(new UploadClientError("complete_failed"));
    const { Wrapper } = createWrapper();

    const { result } = renderHook(
      () =>
        useUploadDocuments("org-1", {
          kind: "canonical",
          folder: "02_Financials",
        }),
      { wrapper: Wrapper },
    );

    act(() => {
      result.current.startUploads([makeFile()]);
    });
    const id = result.current.uploads[0].id;

    await waitFor(() => {
      expect(uploadRegistry.get(id)?.status).toBe("error");
    });
    expect(uploadRegistry.get(id)?.error).toBe("Upload failed. Try again.");
  });

  it("sets a specific friendly message for unsupported_type", async () => {
    uploadFileMock.mockRejectedValue(new UploadClientError("unsupported_type"));
    const { Wrapper } = createWrapper();

    const { result } = renderHook(
      () =>
        useUploadDocuments("org-1", {
          kind: "canonical",
          folder: "02_Financials",
        }),
      { wrapper: Wrapper },
    );

    act(() => {
      result.current.startUploads([makeFile()]);
    });
    const id = result.current.uploads[0].id;

    await waitFor(() => {
      expect(uploadRegistry.get(id)?.status).toBe("error");
    });
    expect(uploadRegistry.get(id)?.error).toMatch(/PDF, DOCX, XLSX/);
  });

  it("sets registry status to error (not canceled) when uploadFile rejects with a non-UploadClientError", async () => {
    uploadFileMock.mockRejectedValue(new Error("boom"));
    const { Wrapper } = createWrapper();

    const { result } = renderHook(
      () =>
        useUploadDocuments("org-1", {
          kind: "canonical",
          folder: "02_Financials",
        }),
      { wrapper: Wrapper },
    );

    act(() => {
      result.current.startUploads([makeFile()]);
    });
    const id = result.current.uploads[0].id;

    await waitFor(() => {
      expect(uploadRegistry.get(id)?.status).toBe("error");
    });
  });

  it("cancelUpload aborts the in-flight upload's signal, landing status canceled", async () => {
    uploadFileMock.mockImplementation(
      (_params: unknown, deps: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          deps.signal?.addEventListener("abort", () => {
            reject(new UploadClientError("canceled"));
          });
        }),
    );
    const { Wrapper } = createWrapper();

    const { result } = renderHook(
      () =>
        useUploadDocuments("org-1", {
          kind: "canonical",
          folder: "02_Financials",
        }),
      { wrapper: Wrapper },
    );

    act(() => {
      result.current.startUploads([makeFile()]);
    });
    const id = result.current.uploads[0].id;

    act(() => {
      result.current.cancelUpload(id);
    });

    await waitFor(() => {
      expect(uploadRegistry.get(id)?.status).toBe("canceled");
    });
    expect(uploadRegistry.get(id)?.error).toBeUndefined();
  });

  it("cancelUpload is a no-op for an id with no tracked controller", () => {
    const { Wrapper } = createWrapper();
    const { result } = renderHook(
      () =>
        useUploadDocuments("org-1", {
          kind: "canonical",
          folder: "02_Financials",
        }),
      { wrapper: Wrapper },
    );

    expect(() => result.current.cancelUpload("no-such-id")).not.toThrow();
  });

  it("dismiss removes the entry from the registry", async () => {
    uploadFileMock.mockResolvedValue({
      documentId: "d1",
      versionId: "v1",
      versionNumber: 1,
    });
    const { Wrapper } = createWrapper();
    const { result } = renderHook(
      () =>
        useUploadDocuments("org-1", {
          kind: "canonical",
          folder: "02_Financials",
        }),
      { wrapper: Wrapper },
    );

    act(() => {
      result.current.startUploads([makeFile()]);
    });
    const id = result.current.uploads[0].id;

    await waitFor(() => {
      expect(uploadRegistry.get(id)?.status).toBe("done");
    });

    act(() => {
      result.current.dismiss(id);
    });

    expect(uploadRegistry.get(id)).toBeUndefined();
  });
});
