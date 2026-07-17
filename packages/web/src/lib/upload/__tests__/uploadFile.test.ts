import { vi } from "vitest";
import { UPLOAD_PART_SIZE } from "@ai-data-room/api-utils/schemas/rooms";

import { uploadFile, UploadClientError } from "../uploadFile";
import type { api } from "@/lib/eden";

const ORG_ID = "org-1";
const DOCUMENT_ID = "44444444-4444-4444-8444-444444444444";
const VERSION_ID = "55555555-5555-4555-8555-555555555555";
const UPLOAD_ID = "upload-abc";

function makeFileStub(name: string, type: string, size: number): File {
  return {
    name,
    type,
    size,
    slice: (start = 0, end = size) => {
      const sliceEnd = Math.min(end, size);
      return { size: Math.max(0, sliceEnd - start) } as Blob;
    },
  } as unknown as File;
}

function makePutResponse(ok: boolean, eTag: string | null): Response {
  return {
    ok,
    headers: { get: (h: string) => (h === "ETag" ? eTag : null) },
  } as unknown as Response;
}

function makeMockApi(deps: {
  initiatePost: ReturnType<typeof vi.fn>;
  completePost: ReturnType<typeof vi.fn>;
  abortDelete: ReturnType<typeof vi.fn>;
}): typeof api {
  const uploadsFn = Object.assign(
    () => ({
      complete: { post: deps.completePost },
      delete: deps.abortDelete,
    }),
    { initiate: { post: deps.initiatePost } },
  );

  return {
    core: {
      orgs: () => ({
        uploads: uploadsFn,
      }),
    },
  } as unknown as typeof api;
}

describe("uploadFile", () => {
  let initiatePost: ReturnType<typeof vi.fn>;
  let completePost: ReturnType<typeof vi.fn>;
  let abortDelete: ReturnType<typeof vi.fn>;
  let mockApi: typeof api;

  beforeEach(() => {
    initiatePost = vi.fn();
    completePost = vi.fn();
    abortDelete = vi
      .fn()
      .mockResolvedValue({ status: 200, data: { ok: true } });
    mockApi = makeMockApi({ initiatePost, completePost, abortDelete });
  });

  it("happy path (single part): initiates, PUTs the whole blob, completes", async () => {
    const file = new File([new Uint8Array(2048)], "Term Sheet.pdf", {
      type: "application/pdf",
    });
    initiatePost.mockResolvedValue({
      status: 201,
      data: {
        uploadId: UPLOAD_ID,
        documentId: DOCUMENT_ID,
        versionId: VERSION_ID,
        key: "orgs/org-1/documents/doc/version",
        parts: [{ partNumber: 1, url: "https://s3.example.com/part1" }],
      },
    });
    const put = makePutResponse(true, '"etag-1"');
    const fetchImpl = vi.fn().mockResolvedValue(put);
    completePost.mockResolvedValue({
      status: 200,
      data: {
        documentId: DOCUMENT_ID,
        versionId: VERSION_ID,
        versionNumber: 1,
      },
    });
    const onProgress = vi.fn();

    const result = await uploadFile(
      {
        orgId: ORG_ID,
        target: { kind: "canonical", folder: "02_Financials" },
        file,
      },
      { api: mockApi, fetchImpl, onProgress },
    );

    expect(initiatePost).toHaveBeenCalledWith({
      target: { kind: "canonical", folder: "02_Financials" },
      filename: "Term Sheet.pdf",
      mimeType: "application/pdf",
      sizeBytes: 2048,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://s3.example.com/part1");
    expect(init.method).toBe("PUT");
    expect((init.body as Blob).size).toBe(2048);
    expect(onProgress).toHaveBeenCalledWith(2048);
    expect(completePost).toHaveBeenCalledWith({
      documentId: DOCUMENT_ID,
      versionId: VERSION_ID,
      parts: [{ partNumber: 1, eTag: '"etag-1"' }],
    });
    expect(abortDelete).not.toHaveBeenCalled();
    expect(result).toEqual({
      documentId: DOCUMENT_ID,
      versionId: VERSION_ID,
      versionNumber: 1,
    });
  });

  it("initiates with an opportunity target when uploading into an Opportunity subroom", async () => {
    const file = new File([new Uint8Array(512)], "MSA_draft.docx", {
      type: "application/pdf",
    });
    initiatePost.mockResolvedValue({
      status: 201,
      data: {
        uploadId: UPLOAD_ID,
        documentId: DOCUMENT_ID,
        versionId: VERSION_ID,
        key: "k",
        parts: [{ partNumber: 1, url: "https://s3.example.com/part1" }],
      },
    });
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(makePutResponse(true, '"etag-1"'));
    completePost.mockResolvedValue({
      status: 200,
      data: {
        documentId: DOCUMENT_ID,
        versionId: VERSION_ID,
        versionNumber: 1,
      },
    });

    await uploadFile(
      {
        orgId: ORG_ID,
        target: { kind: "opportunity", opportunityId: "opp-1" },
        file,
      },
      { api: mockApi, fetchImpl },
    );

    expect(initiatePost).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { kind: "opportunity", opportunityId: "opp-1" },
      }),
    );
  });

  it("happy path (multi-part): PUTs one part per chunk with correct byte ranges", async () => {
    const size = 2 * UPLOAD_PART_SIZE + 1024;
    const file = makeFileStub("Data Pack.zip", "application/pdf", size);
    initiatePost.mockResolvedValue({
      status: 201,
      data: {
        uploadId: UPLOAD_ID,
        documentId: DOCUMENT_ID,
        versionId: VERSION_ID,
        key: "orgs/org-1/documents/doc/version",
        parts: [
          { partNumber: 2, url: "https://s3.example.com/part2" },
          { partNumber: 1, url: "https://s3.example.com/part1" },
          { partNumber: 3, url: "https://s3.example.com/part3" },
        ],
      },
    });
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(makePutResponse(true, '"etag-1"'))
      .mockResolvedValueOnce(makePutResponse(true, '"etag-2"'))
      .mockResolvedValueOnce(makePutResponse(true, '"etag-3"'));
    completePost.mockResolvedValue({
      status: 200,
      data: {
        documentId: DOCUMENT_ID,
        versionId: VERSION_ID,
        versionNumber: 2,
      },
    });
    const onProgress = vi.fn();

    await uploadFile(
      {
        orgId: ORG_ID,
        target: { kind: "canonical", folder: "02_Financials" },
        file,
      },
      { api: mockApi, fetchImpl, onProgress },
    );

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(fetchImpl.mock.calls[0][0]).toBe("https://s3.example.com/part1");
    expect((fetchImpl.mock.calls[0][1].body as Blob).size).toBe(
      UPLOAD_PART_SIZE,
    );
    expect(fetchImpl.mock.calls[1][0]).toBe("https://s3.example.com/part2");
    expect((fetchImpl.mock.calls[1][1].body as Blob).size).toBe(
      UPLOAD_PART_SIZE,
    );
    expect(fetchImpl.mock.calls[2][0]).toBe("https://s3.example.com/part3");
    expect((fetchImpl.mock.calls[2][1].body as Blob).size).toBe(1024);

    expect(onProgress.mock.calls).toEqual([
      [UPLOAD_PART_SIZE],
      [2 * UPLOAD_PART_SIZE],
      [size],
    ]);

    expect(completePost).toHaveBeenCalledWith({
      documentId: DOCUMENT_ID,
      versionId: VERSION_ID,
      parts: [
        { partNumber: 1, eTag: '"etag-1"' },
        { partNumber: 2, eTag: '"etag-2"' },
        { partNumber: 3, eTag: '"etag-3"' },
      ],
    });
  });

  it("throws unsupported_type before any network call for an unsupported mime type", async () => {
    const file = makeFileStub("archive.zip", "application/zip", 1024);

    await expect(
      uploadFile(
        {
          orgId: ORG_ID,
          target: { kind: "canonical", folder: "02_Financials" },
          file,
        },
        { api: mockApi, fetchImpl: vi.fn() },
      ),
    ).rejects.toMatchObject({ reason: "unsupported_type" });

    expect(initiatePost).not.toHaveBeenCalled();
    expect(abortDelete).not.toHaveBeenCalled();
  });

  it("throws initiate_failed with no PUT and no abort when initiate is non-201", async () => {
    const file = makeFileStub("Term Sheet.pdf", "application/pdf", 1024);
    initiatePost.mockResolvedValue({
      status: 400,
      data: null,
      error: { value: { ok: false, reason: "invalid_canonical_folder" } },
    });
    const fetchImpl = vi.fn();

    await expect(
      uploadFile(
        {
          orgId: ORG_ID,
          target: { kind: "canonical", folder: "02_Financials" },
          file,
        },
        { api: mockApi, fetchImpl },
      ),
    ).rejects.toMatchObject({ reason: "initiate_failed" });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(abortDelete).not.toHaveBeenCalled();
  });

  it("throws part_upload_failed and aborts when a part PUT is not ok", async () => {
    const file = makeFileStub("Term Sheet.pdf", "application/pdf", 1024);
    initiatePost.mockResolvedValue({
      status: 201,
      data: {
        uploadId: UPLOAD_ID,
        documentId: DOCUMENT_ID,
        versionId: VERSION_ID,
        key: "k",
        parts: [{ partNumber: 1, url: "https://s3.example.com/part1" }],
      },
    });
    // A valid ETag is present so this scenario ISOLATES the `!put.ok`
    // check from the separate missing-ETag check below — a response that
    // is both non-ok AND missing its ETag would pass even if the `!ok`
    // branch were broken, since the ETag check would still catch it.
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(makePutResponse(false, '"etag-1"'));

    await expect(
      uploadFile(
        {
          orgId: ORG_ID,
          target: { kind: "canonical", folder: "02_Financials" },
          file,
        },
        { api: mockApi, fetchImpl },
      ),
    ).rejects.toMatchObject({ reason: "part_upload_failed" });

    expect(abortDelete).toHaveBeenCalledWith({
      documentId: DOCUMENT_ID,
      versionId: VERSION_ID,
    });
  });

  it("throws part_upload_failed and aborts when the ETag header is missing", async () => {
    const file = makeFileStub("Term Sheet.pdf", "application/pdf", 1024);
    initiatePost.mockResolvedValue({
      status: 201,
      data: {
        uploadId: UPLOAD_ID,
        documentId: DOCUMENT_ID,
        versionId: VERSION_ID,
        key: "k",
        parts: [{ partNumber: 1, url: "https://s3.example.com/part1" }],
      },
    });
    const fetchImpl = vi.fn().mockResolvedValue(makePutResponse(true, null));

    await expect(
      uploadFile(
        {
          orgId: ORG_ID,
          target: { kind: "canonical", folder: "02_Financials" },
          file,
        },
        { api: mockApi, fetchImpl },
      ),
    ).rejects.toMatchObject({ reason: "part_upload_failed" });

    expect(abortDelete).toHaveBeenCalledWith({
      documentId: DOCUMENT_ID,
      versionId: VERSION_ID,
    });
  });

  it("throws complete_failed and aborts when complete is non-200", async () => {
    const file = makeFileStub("Term Sheet.pdf", "application/pdf", 1024);
    initiatePost.mockResolvedValue({
      status: 201,
      data: {
        uploadId: UPLOAD_ID,
        documentId: DOCUMENT_ID,
        versionId: VERSION_ID,
        key: "k",
        parts: [{ partNumber: 1, url: "https://s3.example.com/part1" }],
      },
    });
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(makePutResponse(true, '"etag-1"'));
    completePost.mockResolvedValue({
      status: 409,
      data: null,
      error: { value: { ok: false, reason: "conflict" } },
    });

    await expect(
      uploadFile(
        {
          orgId: ORG_ID,
          target: { kind: "canonical", folder: "02_Financials" },
          file,
        },
        { api: mockApi, fetchImpl },
      ),
    ).rejects.toMatchObject({ reason: "complete_failed" });

    expect(abortDelete).toHaveBeenCalledWith({
      documentId: DOCUMENT_ID,
      versionId: VERSION_ID,
    });
  });

  it("throws canceled and aborts when the signal is already aborted before any part PUT", async () => {
    const file = makeFileStub("Term Sheet.pdf", "application/pdf", 1024);
    initiatePost.mockResolvedValue({
      status: 201,
      data: {
        uploadId: UPLOAD_ID,
        documentId: DOCUMENT_ID,
        versionId: VERSION_ID,
        key: "k",
        parts: [{ partNumber: 1, url: "https://s3.example.com/part1" }],
      },
    });
    const fetchImpl = vi.fn();
    const controller = new AbortController();
    controller.abort();

    await expect(
      uploadFile(
        {
          orgId: ORG_ID,
          target: { kind: "canonical", folder: "02_Financials" },
          file,
        },
        { api: mockApi, fetchImpl, signal: controller.signal },
      ),
    ).rejects.toMatchObject({ reason: "canceled" });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(abortDelete).toHaveBeenCalledWith({
      documentId: DOCUMENT_ID,
      versionId: VERSION_ID,
    });
  });

  it("classifies an abort DURING an in-flight part PUT as canceled, not an error", async () => {
    const file = makeFileStub("Term Sheet.pdf", "application/pdf", 1024);
    initiatePost.mockResolvedValue({
      status: 201,
      data: {
        uploadId: UPLOAD_ID,
        documentId: DOCUMENT_ID,
        versionId: VERSION_ID,
        key: "k",
        parts: [{ partNumber: 1, url: "https://s3.example.com/part1" }],
      },
    });
    const controller = new AbortController();
    // The part PUT is in flight when the caller cancels: the signal flips
    // to aborted and `fetch` rejects with a DOMException AbortError (NOT our
    // UploadClientError). This must still surface as `canceled`.
    const fetchImpl = vi.fn().mockImplementation(() => {
      controller.abort();
      return Promise.reject(
        new DOMException("The operation was aborted.", "AbortError"),
      );
    });

    await expect(
      uploadFile(
        {
          orgId: ORG_ID,
          target: { kind: "canonical", folder: "02_Financials" },
          file,
        },
        { api: mockApi, fetchImpl, signal: controller.signal },
      ),
    ).rejects.toMatchObject({ reason: "canceled" });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(abortDelete).toHaveBeenCalledWith({
      documentId: DOCUMENT_ID,
      versionId: VERSION_ID,
    });
  });

  it("swallows an abort failure and rethrows the original error", async () => {
    const file = makeFileStub("Term Sheet.pdf", "application/pdf", 1024);
    initiatePost.mockResolvedValue({
      status: 201,
      data: {
        uploadId: UPLOAD_ID,
        documentId: DOCUMENT_ID,
        versionId: VERSION_ID,
        key: "k",
        parts: [{ partNumber: 1, url: "https://s3.example.com/part1" }],
      },
    });
    const fetchImpl = vi.fn().mockResolvedValue(makePutResponse(false, null));
    abortDelete.mockRejectedValue(new Error("network down"));

    await expect(
      uploadFile(
        {
          orgId: ORG_ID,
          target: { kind: "canonical", folder: "02_Financials" },
          file,
        },
        { api: mockApi, fetchImpl },
      ),
    ).rejects.toBeInstanceOf(UploadClientError);
  });
});
