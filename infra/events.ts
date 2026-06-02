// Core domain-event bus — slice 17 / org-provisioning T-005.
//
// First EventBridge infrastructure in the repo. A single shared
// EventBus carries this service's domain events (routed by detail-type),
// rather than a bus per event — the first rider is `org.created`
// (emitted by `createOrg` via the PutEvents adapter in
// `infrastructure/events/eventBridgeOrgEventPublisher.ts`), which
// `room-and-folders` will subscribe to in slice 2 to provision the
// canonical room idempotently (FR3 / NFR2).
//
// Linked to the core API Lambda in `infra/api.ts`. The Bus `getSSTLink`
// exposes `{ name, arn }` (consumed as `Resource.CoreEventBus.name`) and
// auto-attaches an `events:*` IAM permission scoped to this bus, so the
// adapter can `PutEvents` without a hand-rolled policy.
//
// Stage-agnostic: SST suffixes the physical bus name with `$app.stage`,
// so dev / staging / production each get their own isolated bus from
// this one declaration.
//
// ⚠️ First EventBridge component — `infra/_sst-globals.d.ts` types
// `sst.aws.*` as `any`, so a wrong component name wouldn't fail
// typecheck. Validated with `bun sst diff --stage <stage>` before the
// PR pushes (CLAUDE.md non-negotiable #7).
//
// Subscribers are owned by the consuming slice (a `bus.subscribe(...)`
// rule lands with `room-and-folders`), not declared here — this slice
// owns only the producer + the bus.

export const eventBus = new sst.aws.Bus("CoreEventBus");
