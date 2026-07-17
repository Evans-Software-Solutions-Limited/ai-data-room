// Scheduled jobs (EventBridge cron → Lambda).
//
// **Status: stub — deferred to the AWS/deploy batch (T-001).** The
// retention sweep's application logic ships now in T-010
// (`microservices/core/src/application/room/retention.ts`, fully covered by
// unit + frozen-clock integration tests). What's deferred here is only the
// AWS wiring, for two hard reasons:
//   1. The sweep Lambda constructs an S3 document store from
//      `Resource.DocsBucket` / `Resource.DocsBucketKmsKeyId`, which the
//      storage infra (T-001, `infra/storage.ts`) has NOT declared yet — so
//      a real handler + cron here can't typecheck or resolve today.
//   2. AWS creds are expired this session, so the mandatory
//      `bun sst diff` guardrail (CLAUDE.md non-negotiable #7) can't run on
//      a new SST component. Pushing an unverified `sst.aws.Cron` name would
//      violate that guardrail (`infra/_sst-globals.d.ts` types components
//      as `any`, so a typo only surfaces at deploy).
//
// Target shape (per specs/ai-data-room/room-and-folders/design.md §408 +
// tasks.md T-010), to restore alongside T-001's `DocsBucket`:
//   - `new sst.aws.Cron("RoomRetentionSweep", { schedule: "rate(6 hours)",
//       function: { handler: "microservices/core/src/handlers/schedule/
//       retention.handler", link: [DocsBucket, PLANETSCALE_DATABASE_URL],
//       environment: {...} } })`.
//   - The handler wrapper (`handlers/schedule/retention.ts`) is pure wiring
//     (getDb + createS3DocumentStore(Resource.DocsBucket…) + new OrgRepo +
//     AuditRepo → `runRetentionSweep`), unit-coverage-excluded like
//     `handlers/webhooks/workosLambda.ts`.
//   - Verify: one real invocation deletes the seeded expired rows and the
//     `room.retention.*` EMF metrics emit (the deploy-time leg, batched
//     with T-001 / T-017).

export {};
