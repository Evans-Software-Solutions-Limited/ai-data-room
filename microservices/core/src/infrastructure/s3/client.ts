// Thin wrapper over `@aws-sdk/client-s3` (+ `@aws-sdk/s3-request-presigner`)
// for the document object store — slice `room-and-folders` / T-005.
//
// Exposes only the operations the upload/download pipelines in
// `design.md` actually use (`createMultipartUpload`, `presignPartUrls`,
// `completeMultipartUpload`, `abortMultipartUpload`, `presignDownloadUrl`,
// `headObject`, `deleteObject`, `computeSha256`) — anything else in the
// SDK's surface stays out so the application layer can't accidentally
// couple itself to S3 behaviour we haven't designed for.
//
// Architecture (mirrors `infrastructure/workos/client.ts`):
//   - **Factory function**, not a class. Module load is side-effect
//     free; the SDK client is constructed by the caller and injected
//     via `deps.client`, so tests can pass an `aws-sdk-client-mock`
//     stub without any module-load trickery.
//   - **Config injected, no `Resource`.** `deps.bucket` is the bucket
//     name; T-011 (the application layer) reads
//     `Resource.<bucket>.name` from SST and passes it down. This file
//     does NOT import `Resource` or `sst` — keeps the wrapper
//     unit-testable without an SST shim, per the layered-architecture
//     rule in CLAUDE.md.
//   - **Thin surface, caller builds keys.** Per §Storage layout, the
//     full object key is `orgs/<org_id>/documents/<document_id>/<version_id>`.
//     This wrapper never constructs that key — every method takes a
//     pre-built `key: string` from the caller. Keeping key-building out
//     of infrastructure means the storage-layout convention lives in
//     exactly one place (the application layer), not duplicated here.
//   - **Re-exports SDK types** (`S3Client`, a `CompletedPart`-shaped
//     type) so `application/*.ts` never has to
//     `import "@aws-sdk/client-s3"` directly.
//
// SSE-KMS: the bucket has SSE-KMS enabled by default (T-001), but we
// still pass `ServerSideEncryption: "aws:kms"` explicitly on
// `CreateMultipartUploadCommand` (belt and braces — matches the
// bucket's default so a future bucket-policy change can't silently
// downgrade uploads). When `deps.kmsKeyId` is set, we pass
// `SSEKMSKeyId` explicitly too, pinning the write to a specific CMK
// rather than relying on the bucket's default key.
//
// sha256: the design's upload pipeline computes sha256 "via HEAD /
// copy" where possible, else streams to compute on completion. S3
// doesn't expose a native sha256 checksum via HEAD, so
// `computeSha256` always streams the object body through
// `crypto.createHash("sha256")` — the "stream to compute" fallback
// path is the one implemented here; T-006 decides when to call it.

import { createHash } from "node:crypto";
import type { Readable } from "node:stream";

import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectTaggingCommand,
  S3Client,
  UploadPartCommand,
  type CompletedPart,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// Re-export the SDK shapes the application layer needs so
// `application/*.ts` never has to `import "@aws-sdk/client-s3"`
// directly — crossing that boundary would defeat the
// layered-architecture rule in CLAUDE.md.
export type { CompletedPart, S3Client };

/** One completed part as the application layer collects them from
 *  client-reported ETags — deliberately a subset of the SDK's
 *  `CompletedPart` (camelCase, no optional SDK-only fields) so callers
 *  don't have to know the SDK's `PartNumber`/`ETag` casing. */
export interface CompletedUploadPart {
  partNumber: number;
  eTag: string;
}

export interface S3DocumentStoreDeps {
  /** Injected so tests can mock; the caller constructs the real client. */
  client: S3Client;
  /** Bucket name — injected (T-011 reads `Resource.<bucket>.name` and
   *  passes it here). Do NOT read `Resource` in this file. */
  bucket: string;
  /** Optional SSE-KMS CMK id. When set, writes pass it explicitly; the
   *  bucket also has SSE-KMS enabled by default (T-001) so omitting
   *  this still results in an encrypted object under the bucket's
   *  default key. */
  kmsKeyId?: string;
}

/**
 * Construct the S3 document-store wrapper.
 *
 * Pattern usage at handler/application scope (warm-Lambda safe):
 *
 *   const store = createS3DocumentStore({
 *     client: new S3Client({}),
 *     bucket: Resource.DocsBucket.name,
 *     kmsKeyId: Resource.DocsBucketKmsKeyId?.value,
 *   });
 *
 * Don't lift the call to module top-level in a way that reads
 * `Resource` — that binding is only available once the Lambda's
 * module-init phase has the SST runtime attached. Callers construct
 * `S3Client` and read `Resource` themselves; this factory just wires
 * them together.
 */
export function createS3DocumentStore(deps: S3DocumentStoreDeps) {
  const { client, bucket, kmsKeyId } = deps;

  return {
    async createMultipartUpload(
      key: string,
      contentType: string,
    ): Promise<string> {
      const output = await client.send(
        new CreateMultipartUploadCommand({
          Bucket: bucket,
          Key: key,
          ContentType: contentType,
          ServerSideEncryption: "aws:kms",
          ...(kmsKeyId ? { SSEKMSKeyId: kmsKeyId } : {}),
        }),
      );

      if (!output.UploadId) {
        throw new Error(
          `S3 CreateMultipartUpload for key "${key}" returned no UploadId`,
        );
      }

      return output.UploadId;
    },

    async presignPartUrls(
      key: string,
      uploadId: string,
      partNumbers: number[],
      ttlSeconds: number,
    ): Promise<{ partNumber: number; url: string }[]> {
      return Promise.all(
        partNumbers.map(async (partNumber) => ({
          partNumber,
          url: await getSignedUrl(
            client,
            new UploadPartCommand({
              Bucket: bucket,
              Key: key,
              UploadId: uploadId,
              PartNumber: partNumber,
            }),
            { expiresIn: ttlSeconds },
          ),
        })),
      );
    },

    async completeMultipartUpload(
      key: string,
      uploadId: string,
      parts: CompletedUploadPart[],
    ): Promise<{ versionId: string | null }> {
      const sortedParts = [...parts].sort(
        (a, b) => a.partNumber - b.partNumber,
      );

      const output = await client.send(
        new CompleteMultipartUploadCommand({
          Bucket: bucket,
          Key: key,
          UploadId: uploadId,
          MultipartUpload: {
            Parts: sortedParts.map((part) => ({
              ETag: part.eTag,
              PartNumber: part.partNumber,
            })),
          },
        }),
      );

      return { versionId: output.VersionId ?? null };
    },

    async abortMultipartUpload(key: string, uploadId: string): Promise<void> {
      await client.send(
        new AbortMultipartUploadCommand({
          Bucket: bucket,
          Key: key,
          UploadId: uploadId,
        }),
      );
    },

    async presignDownloadUrl(
      key: string,
      opts: { versionId?: string; ttlSeconds: number },
    ): Promise<string> {
      return getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
          ...(opts.versionId ? { VersionId: opts.versionId } : {}),
        }),
        { expiresIn: opts.ttlSeconds },
      );
    },

    async headObject(
      key: string,
      versionId?: string,
    ): Promise<{
      sizeBytes: number;
      contentType?: string;
      versionId?: string;
    }> {
      const output = await client.send(
        new HeadObjectCommand({
          Bucket: bucket,
          Key: key,
          ...(versionId ? { VersionId: versionId } : {}),
        }),
      );

      return {
        sizeBytes: output.ContentLength ?? 0,
        contentType: output.ContentType,
        versionId: output.VersionId,
      };
    },

    async deleteObject(key: string, versionId?: string): Promise<void> {
      await client.send(
        new DeleteObjectCommand({
          Bucket: bucket,
          Key: key,
          ...(versionId ? { VersionId: versionId } : {}),
        }),
      );
    },

    /**
     * Replace an object's tag set (§Storage layout). The hard-delete path
     * (T-009) uses this to stamp `state=hard-deleted` on each version's
     * object; the bucket lifecycle rule (T-001) reclaims tagged objects
     * after a 7-day ops grace, so we mark-for-reclaim here rather than
     * deleting the bytes outright. `PutObjectTagging` REPLACES the whole
     * tag set (S3 has no "add one tag" op), which is what we want — the
     * only tag we set on document objects is this state marker. Pass
     * `versionId` to tag a specific S3 object version.
     */
    async tagObject(
      key: string,
      tags: Record<string, string>,
      versionId?: string,
    ): Promise<void> {
      await client.send(
        new PutObjectTaggingCommand({
          Bucket: bucket,
          Key: key,
          ...(versionId ? { VersionId: versionId } : {}),
          Tagging: {
            TagSet: Object.entries(tags).map(([Key, Value]) => ({
              Key,
              Value,
            })),
          },
        }),
      );
    },

    async computeSha256(key: string, versionId?: string): Promise<string> {
      const output = await client.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
          ...(versionId ? { VersionId: versionId } : {}),
        }),
      );

      const body = output.Body as Readable | undefined;
      if (!body) {
        throw new Error(`S3 GetObject for key "${key}" returned no Body`);
      }

      const hash = createHash("sha256");
      for await (const chunk of body) {
        hash.update(chunk as Buffer);
      }

      return hash.digest("hex");
    },
  };
}

export type S3DocumentStore = ReturnType<typeof createS3DocumentStore>;
