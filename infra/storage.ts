// Document storage.
//
// **Status: stub.** Document storage is slice-2 (`room-and-folders`)
// infra. Nothing in auth-and-orgs reads or writes objects, so declaring
// a bucket + KMS key here would provision AWS resources that no handler
// uses and bind the stack to CloudFormation churn every deploy. Matches
// the same "declare when the slice that needs it ships" convention that
// `infra/secrets.ts` uses for future-slice secrets.
//
// Slice 2 will restore the real declarations via `room-and-folders`
// tasks. Target shape (per `specs/ai-data-room/room-and-folders/design.md`):
//   - One bucket per stage, SSE-KMS at rest, public access blocked.
//   - Object keys: orgs/<orgId>/rooms/<roomId>/<slotId>/<versionId>/<filename>
//   - Multipart resumable uploads, lifecycle rules for cache tier.
//   - Customer-managed KMS key via the Pulumi AWS provider:
//       `new aws.kms.Key(...)` + `new sst.Linkable(...)` wrapper
//     (mirrors FDP's `infra/kms.ts` — `sst.aws.KmsKey` does NOT exist
//     in SST v4.10; use `aws.kms.Key` from `@pulumi/aws`).
//
// A second, cheaper bucket (`aiCacheBucket`) for Q&A passage cache +
// sense-check extracted-text staging also lands in slice 2 / slice 5
// so lifecycle rules stay scoped.

export {};
