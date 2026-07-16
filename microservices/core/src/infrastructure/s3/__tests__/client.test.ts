// Unit tests for the S3 document-store wrapper — slice `room-and-folders`
// / T-005. Command-shaped assertions (`CreateMultipartUploadCommand`,
// `HeadObjectCommand`, ...) are verified via `aws-sdk-client-mock`; the
// two presign methods construct a *real* `S3Client` (no network — signing
// happens locally) so we can assert the actual query-string shape
// `getSignedUrl` produces.

import { Readable } from "node:stream";

import { beforeEach, describe, expect, it } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import { createS3DocumentStore } from "../client";

const BUCKET = "aidr-docs-test";
const KEY = "orgs/org-1/documents/doc-1/version-1";

// This workspace's dependency graph currently resolves two different
// `@smithy/types` patch versions transitively (`aws-sdk-client-mock`'s own
// resolution vs `@aws-sdk/client-s3`'s) — a benign "dual package hazard"
// that doesn't affect runtime behaviour (both are the same SDK classes at
// runtime) but trips TS's structural check on every `mockClient()`/`.on()`/
// `.commandCalls()` call. `as never` at the exact points aws-sdk-client-mock
// touches the SDK types sidesteps the mismatch without touching the SDK
// classes themselves or any dependency resolution.
const s3Mock = mockClient(S3Client as never);

// `getSignedUrl` signs locally against a real client's credentials —
// no network call is made, so this is safe to construct in a unit test.
const realClient = new S3Client({
  region: "eu-west-2",
  credentials: { accessKeyId: "test", secretAccessKey: "test" },
});

describe("createS3DocumentStore", () => {
  beforeEach(() => {
    s3Mock.reset();
  });

  describe("createMultipartUpload", () => {
    it("returns the UploadId and sends ServerSideEncryption: aws:kms", async () => {
      s3Mock
        .on(CreateMultipartUploadCommand as never)
        .resolves({ UploadId: "upload-1" } as never);
      const store = createS3DocumentStore({
        client: s3Mock as never,
        bucket: BUCKET,
      });

      const uploadId = await store.createMultipartUpload(
        KEY,
        "application/pdf",
      );

      expect(uploadId).toBe("upload-1");
      const call = s3Mock.commandCalls(
        CreateMultipartUploadCommand as never,
      )[0];
      expect(call.args[0].input).toMatchObject({
        Bucket: BUCKET,
        Key: KEY,
        ContentType: "application/pdf",
        ServerSideEncryption: "aws:kms",
      });
      expect(call.args[0].input.SSEKMSKeyId).toBeUndefined();
    });

    it("passes SSEKMSKeyId when kmsKeyId is configured", async () => {
      s3Mock
        .on(CreateMultipartUploadCommand as never)
        .resolves({ UploadId: "upload-2" } as never);
      const store = createS3DocumentStore({
        client: s3Mock as never,
        bucket: BUCKET,
        kmsKeyId: "arn:aws:kms:eu-west-2:123456789012:key/cmk-1",
      });

      await store.createMultipartUpload(KEY, "application/pdf");

      const call = s3Mock.commandCalls(
        CreateMultipartUploadCommand as never,
      )[0];
      expect(call.args[0].input.SSEKMSKeyId).toBe(
        "arn:aws:kms:eu-west-2:123456789012:key/cmk-1",
      );
    });

    it("throws when the SDK returns no UploadId", async () => {
      s3Mock.on(CreateMultipartUploadCommand as never).resolves({});
      const store = createS3DocumentStore({
        client: s3Mock as never,
        bucket: BUCKET,
      });

      await expect(
        store.createMultipartUpload(KEY, "application/pdf"),
      ).rejects.toThrow(/no UploadId/);
    });
  });

  describe("presignPartUrls", () => {
    it("returns one signed url per part number", async () => {
      const store = createS3DocumentStore({
        client: realClient,
        bucket: BUCKET,
      });

      const urls = await store.presignPartUrls(KEY, "upload-1", [1, 2, 3], 900);

      expect(urls).toHaveLength(3);
      urls.forEach((entry, i) => {
        expect(entry.partNumber).toBe(i + 1);
        expect(entry.url).toContain(
          encodeURIComponent(KEY).replace(/%2F/g, "/"),
        );
        expect(entry.url).toContain("X-Amz-Algorithm=AWS4-HMAC-SHA256");
        expect(entry.url).toContain("X-Amz-Expires=900");
        expect(entry.url).toContain("X-Amz-Signature=");
      });
    });
  });

  describe("completeMultipartUpload", () => {
    it("sorts parts ascending by partNumber and returns the VersionId", async () => {
      s3Mock
        .on(CompleteMultipartUploadCommand as never)
        .resolves({ VersionId: "v-123" } as never);
      const store = createS3DocumentStore({
        client: s3Mock as never,
        bucket: BUCKET,
      });

      const result = await store.completeMultipartUpload(KEY, "upload-1", [
        { partNumber: 2, eTag: "etag-2" },
        { partNumber: 1, eTag: "etag-1" },
        { partNumber: 3, eTag: "etag-3" },
      ]);

      expect(result).toEqual({ versionId: "v-123" });
      const call = s3Mock.commandCalls(
        CompleteMultipartUploadCommand as never,
      )[0];
      expect(call.args[0].input.MultipartUpload?.Parts).toEqual([
        { ETag: "etag-1", PartNumber: 1 },
        { ETag: "etag-2", PartNumber: 2 },
        { ETag: "etag-3", PartNumber: 3 },
      ]);
    });

    it("returns null versionId when the SDK omits it (unversioned bucket)", async () => {
      s3Mock.on(CompleteMultipartUploadCommand as never).resolves({});
      const store = createS3DocumentStore({
        client: s3Mock as never,
        bucket: BUCKET,
      });

      const result = await store.completeMultipartUpload(KEY, "upload-1", [
        { partNumber: 1, eTag: "etag-1" },
      ]);

      expect(result).toEqual({ versionId: null });
    });
  });

  describe("abortMultipartUpload", () => {
    it("sends the bucket/key/uploadId", async () => {
      s3Mock.on(AbortMultipartUploadCommand as never).resolves({});
      const store = createS3DocumentStore({
        client: s3Mock as never,
        bucket: BUCKET,
      });

      await store.abortMultipartUpload(KEY, "upload-1");

      const call = s3Mock.commandCalls(AbortMultipartUploadCommand as never)[0];
      expect(call.args[0].input).toMatchObject({
        Bucket: BUCKET,
        Key: KEY,
        UploadId: "upload-1",
      });
    });
  });

  describe("presignDownloadUrl", () => {
    it("returns a url containing the key and expiry", async () => {
      const store = createS3DocumentStore({
        client: realClient,
        bucket: BUCKET,
      });

      const url = await store.presignDownloadUrl(KEY, { ttlSeconds: 300 });

      expect(url).toContain(encodeURIComponent(KEY).replace(/%2F/g, "/"));
      expect(url).toContain("X-Amz-Expires=300");
      expect(url).not.toContain("versionId=");
    });

    it("includes versionId when a specific version is requested", async () => {
      const store = createS3DocumentStore({
        client: realClient,
        bucket: BUCKET,
      });

      const url = await store.presignDownloadUrl(KEY, {
        versionId: "v-123",
        ttlSeconds: 300,
      });

      expect(url).toContain("versionId=v-123");
    });
  });

  describe("headObject", () => {
    it("maps ContentLength/ContentType/VersionId", async () => {
      s3Mock.on(HeadObjectCommand as never).resolves({
        ContentLength: 4096,
        ContentType: "application/pdf",
        VersionId: "v-123",
      } as never);
      const store = createS3DocumentStore({
        client: s3Mock as never,
        bucket: BUCKET,
      });

      const result = await store.headObject(KEY, "v-123");

      expect(result).toEqual({
        sizeBytes: 4096,
        contentType: "application/pdf",
        versionId: "v-123",
      });
      const call = s3Mock.commandCalls(HeadObjectCommand as never)[0];
      expect(call.args[0].input).toMatchObject({
        Bucket: BUCKET,
        Key: KEY,
        VersionId: "v-123",
      });
    });

    it("defaults sizeBytes to 0 when ContentLength is absent", async () => {
      s3Mock.on(HeadObjectCommand as never).resolves({});
      const store = createS3DocumentStore({
        client: s3Mock as never,
        bucket: BUCKET,
      });

      const result = await store.headObject(KEY);

      expect(result.sizeBytes).toBe(0);
      const call = s3Mock.commandCalls(HeadObjectCommand as never)[0];
      expect(call.args[0].input.VersionId).toBeUndefined();
    });
  });

  describe("deleteObject", () => {
    it("sends bucket/key without a version", async () => {
      s3Mock.on(DeleteObjectCommand as never).resolves({});
      const store = createS3DocumentStore({
        client: s3Mock as never,
        bucket: BUCKET,
      });

      await store.deleteObject(KEY);

      const call = s3Mock.commandCalls(DeleteObjectCommand as never)[0];
      expect(call.args[0].input).toEqual({ Bucket: BUCKET, Key: KEY });
    });

    it("sends the VersionId when deleting a specific version", async () => {
      s3Mock.on(DeleteObjectCommand as never).resolves({});
      const store = createS3DocumentStore({
        client: s3Mock as never,
        bucket: BUCKET,
      });

      await store.deleteObject(KEY, "v-123");

      const call = s3Mock.commandCalls(DeleteObjectCommand as never)[0];
      expect(call.args[0].input).toMatchObject({
        Bucket: BUCKET,
        Key: KEY,
        VersionId: "v-123",
      });
    });
  });

  describe("computeSha256", () => {
    it("streams the object body and returns the sha256 hex digest", async () => {
      s3Mock.on(GetObjectCommand as never).resolves({
        Body: Readable.from([Buffer.from("hello world")]),
      } as never);
      const store = createS3DocumentStore({
        client: s3Mock as never,
        bucket: BUCKET,
      });

      const digest = await store.computeSha256(KEY);

      expect(digest).toBe(
        "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9",
      );
    });

    it("requests the specific VersionId when given", async () => {
      s3Mock.on(GetObjectCommand as never).resolves({
        Body: Readable.from([Buffer.from("hello world")]),
      } as never);
      const store = createS3DocumentStore({
        client: s3Mock as never,
        bucket: BUCKET,
      });

      await store.computeSha256(KEY, "v-123");

      const call = s3Mock.commandCalls(GetObjectCommand as never)[0];
      expect(call.args[0].input).toMatchObject({
        Bucket: BUCKET,
        Key: KEY,
        VersionId: "v-123",
      });
    });

    it("throws a clear error when GetObject returns no Body", async () => {
      s3Mock.on(GetObjectCommand as never).resolves({} as never);
      const store = createS3DocumentStore({
        client: s3Mock as never,
        bucket: BUCKET,
      });

      await expect(store.computeSha256(KEY)).rejects.toThrow(/no Body/);
    });
  });
});
