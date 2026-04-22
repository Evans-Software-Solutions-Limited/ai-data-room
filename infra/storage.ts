// Document storage. Per `specs/ai-data-room/room-and-folders/design.md`:
//  - One bucket per environment, SSE-KMS at rest.
//  - Object keys: orgs/<orgId>/rooms/<roomId>/<slotId>/<versionId>/<filename>
//  - Multipart resumable uploads enabled.
//  - Lifecycle rules added in slice 2 (room-and-folders) tasks.

export const documentsKey = new sst.aws.KmsKey("DocumentsKmsKey");

export const documentsBucket = new sst.aws.Bucket("DocumentsBucket", {
  // Block all public access; downloads happen via signed URLs minted by
  // the access-control slice (NDA + scope check + permission tier).
  public: false,
  // Enable versioning so we never lose a slot's prior version when an
  // owner replaces a doc — the doc-checklist slice depends on the
  // version timeline being intact.
  versioning: true,
});

// Q&A passage cache + sense-check extracted-text staging bucket. Cheaper
// to keep these out of the main documents bucket so we can apply
// different lifecycle rules and avoid name-clash blast-radius.
export const aiCacheBucket = new sst.aws.Bucket("AiCacheBucket", {
  public: false,
});
