# Tasks — ai-data-room / doc-checklist

**Status:** draft
**Design:** [./design.md](./design.md)
**Last updated:** 2026-04-21

Assumes `auth-and-orgs` (v0.1) and `room-and-folders` (v0.2) are
merged. Runs in the same monorepo. Does **not** assume
`access-control` (v0.3) is merged — the handlers use the same
`requires(...)` decorator and will be no-ops until v0.3 replaces the
middleware body. Safe to ship v0.4 before v0.3 if scheduling demands
it, but v0.3 is still the recommended order.

## Conventions
Same as prior slices.

---

## T-001 — Migrations: templates + slots + slot_instances + column add
Status: `[ ]`
**Scope:** Drizzle migrations for `checklist_templates`,
`checklist_slots`, `checklist_slot_instances`; add
`assigned_slot_instance_id` column + FK on `document_versions` (from
`room-and-folders`). Include CHECK constraints (XOR
`canonical_folder` / `opportunity_id` on `checklist_slot_instances`),
unique indexes, and the completion composite index.
**Files (likely):** `packages/db/schema/checklist.ts`,
`packages/db/schema/room.ts` (modify), `packages/db/migrations/*.sql`.
**DoD:** Applies clean + roll back in test DB; drizzle introspection
matches schema file.
**Tests required:** Integration migration test.

---

## T-002 — Domain: canonical template definitions in code
Status: `[ ]`
**Scope:** Create `microservices/core/domain/checklist/templates/`
with one file per canonical folder + `opportunity_default.ts` +
`index.ts`. Each file exports a typed `TemplateDefinition` const.
**v0.1 scope for content**: placeholder slot lists pending Curtis
review. The shape is what ships; the exact slots land in T-003.
**Files (likely):**
`microservices/core/domain/checklist/templates/*.ts`,
`microservices/core/domain/checklist/types.ts`.
**DoD:** All seven template files present, typed, passing
`tsc --strict`; exported from `index.ts`.
**Tests required:** Vitest — schema validation of each template's
shape (all slot_keys stable + unique within template; all
`plainLanguage` strings non-empty).

---

## T-003 — Domain: Curtis-signed canonical content
Status: `[ ]`
**Scope:** Replace placeholder slot lists in T-002 with the
Curtis-approved canonical slots for the six folders +
Opportunity default. This task is **blocking** — Curtis has to sign
off on wording + criteria before merge.
**Files (likely):** Same as T-002.
**DoD:** Each template has Curtis's name + date in a header comment;
PR merged with Curtis as co-reviewer.
**Tests required:** Snapshot test of each template's slot list +
criteria — future edits must be deliberate.

---

## T-004 — Domain: types + zod schemas
Status: `[ ]`
**Scope:** `TemplateDefinition`, `SlotDefinition`, `SlotCriteria`,
`SlotState` enum, `SlotTransition`, `NaReason`. Zod schemas for
request/response DTOs (approve body, reject body with `reason`,
mark-na body, edit-slot body, completion response).
**Files (likely):** `microservices/core/domain/checklist/*.ts`
(extend from T-002), `packages/api-utils/schemas/checklist.ts`.
**DoD:** Barrel exports; schema tests.
**Tests required:** Vitest.

---

## T-005 — Infrastructure: repositories
Status: `[ ]`
**Scope:** `ChecklistTemplateRepo`, `ChecklistSlotRepo`,
`ChecklistSlotInstanceRepo`. Query methods: `getTemplatesForOrg`,
`getSlotsForTemplate`, `getInstanceByLocation`,
`listInstancesForCanonical`, `listInstancesForOpportunity`,
`transitionState`, `assignDocument`, `clearDocument`,
`completionCounts(orgId, folder)`.
**Files (likely):**
`microservices/core/infrastructure/db/checklist/*.ts`.
**DoD:** Each method has an integration test.
**Tests required:** Vitest integration.

---

## T-006 — Application: seed-on-org-create
Status: `[ ]`
**Scope:** `seedChecklistForOrg(orgId, tx)` — iterates code-level
templates, inserts `checklist_templates`, `checklist_slots`, and
`checklist_slot_instances` (with `state='empty'`) for each canonical
folder + the Opportunity default template (no instances at seed time
— those land on Opportunity create). Transactional. Called from
`auth-and-orgs`'s signup handler.
**Files (likely):**
`microservices/core/application/checklist/seed.ts`, and a thin call
site edit in `microservices/core/application/auth/signup.ts`.
**DoD:** Org create + checklist seed is atomic; a failure in seeding
rolls back the org creation.
**Tests required:** Integration — signup creates all expected
`checklist_*` rows; failure-injection rolls back.

---

## T-007 — Application: Opportunity subroom slot cloning
Status: `[ ]`
**Scope:** Extend `room-and-folders`'s `createOpportunity` to
additionally clone the org's `opportunity_default` template's slots
into `checklist_slot_instances` rows scoped to the new subroom.
Transactional with the `opportunities` insert.
**Files (likely):**
`microservices/core/application/room/opportunities.ts` (modify —
adds a call into `microservices/core/application/checklist/clone.ts`).
**DoD:** Creating an Opportunity yields a complete checklist scoped
to that subroom; archiving the Opportunity leaves instances intact
(soft retention).
**Tests required:** Integration.

---

## T-008 — Application: slot state machine
Status: `[ ]`
**Scope:** `approveSlot`, `rejectSlot(reason)`, `markSlotNa(reason)`,
`clearSlotNa`, `resetSlot`. Each validates the current state,
updates `state` + `last_transitioned_{by,at}`, and writes an audit
event. Reject also clears `assigned_document_id`.
**Files (likely):**
`microservices/core/application/checklist/transitions.ts`.
**DoD:** FR2, FR3 covered; illegal transitions rejected
(`empty` → `approved` without `uploaded` state).
**Tests required:** Unit — table-driven transition matrix.

---

## T-009 — Application: slot assignment on upload
Status: `[ ]`
**Scope:** Extend `room-and-folders`'s `completeUpload` to:
- accept optional `slotInstanceId` param on the initiate DTO;
- on complete, set `document_versions.assigned_slot_instance_id`
  AND `checklist_slot_instances.assigned_document_id` +
  `state='uploaded'`;
- emit `slot.uploaded` event for `ai-doc-sensecheck`.
Uncategorised uploads skip this step (`slotInstanceId` null).
**Files (likely):**
`microservices/core/application/room/upload.ts` (modify),
`microservices/core/application/checklist/assign.ts` (new).
**DoD:** Upload with slot id → slot becomes `uploaded`; upload
without → document is uncategorised.
**Tests required:** Integration.

---

## T-010 — Application: slot revert on document soft-delete
Status: `[ ]`
**Scope:** Extend `room-and-folders`'s `softDeleteDocument` to: if
the doc's current version has `assigned_slot_instance_id`, revert
that instance to `state='empty'` and clear `assigned_document_id`.
Audit event: `slot_reset_by_document_delete`.
**Files (likely):**
`microservices/core/application/room/deletion.ts` (modify).
**DoD:** Deleting an uploaded doc leaves the slot empty again.
**Tests required:** Integration.

---

## T-011 — Application: template CRUD (admin)
Status: `[ ]`
**Scope:** `editSlot(templateId, slotId, patch)`, `addCustomSlot`,
`hideSlot`, `reorderSlot`. All audit-logged. Admin-gated through the
`requires(...)` decorator.
**Files (likely):**
`microservices/core/application/checklist/template-admin.ts`.
**DoD:** FR4, FR6 covered.
**Tests required:** Unit + integration.

---

## T-012 — Application: completion computation
Status: `[ ]`
**Scope:** `getFolderCompletion(orgId, canonical)` +
`getOpportunityCompletion(opportunityId)` +
`getRoomCompletion(orgId)`. Uses the indexed SQL aggregate from
design.md. Returns `{ totalRequired, completedRequired, percent }`.
**Files (likely):**
`microservices/core/application/checklist/completion.ts`.
**DoD:** NFR1 — ≤100ms p95 for folders up to 50 slots.
**Tests required:** Integration with 50-slot fixture + p95
measurement.

---

## T-013 — Handlers: checklist + templates + completion
Status: `[ ]`
**Scope:** Wire application into HTTP per design.md. All routes
behind `requires(target, capability)` decorator (slice 3's
middleware — a no-op shim until v0.3 lands).
**Files (likely):**
`microservices/core/handlers/checklist/*.ts`,
`microservices/core/handlers/templates/*.ts`,
`infra/api.ts` (register).
**DoD:** Every route in design.md responds per schema.
**Tests required:** Integration per route.

---

## T-014 — Events: slot lifecycle emission
Status: `[ ]`
**Scope:** Emit `slot.uploaded`, `slot.approved`, `slot.rejected`,
`slot.na_set`, `slot.na_cleared`, `slot.reset` to EventBridge so
`ai-doc-sensecheck` (slice 5) and UI live-updates can subscribe.
**Files (likely):**
`microservices/core/infrastructure/events/checklist.ts`.
**DoD:** Events observable in CloudWatch with `orgId`, `slotInstanceId`,
`documentVersionId?`, `actorUserId`.
**Tests required:** Integration.

---

## T-015 — Web: folder view with slot list
Status: `[ ]`
**Scope:** Canonical folder page lists required slots + their state;
empty slots show an "Upload to this slot" button; filled slots show
the assigned doc + admin actions (approve / reject / mark N/A).
Uncategorised uploads shown in a separate "Uncategorised" section at
the bottom.
**Files (likely):**
`packages/web/app/room/folders/[canonical]/page.tsx`.
**DoD:** AC-US1 (`user can see which slots are filled`) passes.
**Tests required:** Playwright.

---

## T-016 — Web: Opportunity subroom checklist
Status: `[ ]`
**Scope:** Opportunity page renders the cloned checklist same as
folders; completion bar at top.
**Files (likely):**
`packages/web/app/room/opportunities/[id]/page.tsx` (extend from
v0.2).
**DoD:** AC-US2 passes.
**Tests required:** Playwright.

---

## T-017 — Web: slot detail + admin actions
Status: `[ ]`
**Scope:** Clicking a slot opens a side panel with guidance,
criteria (read-only for non-admins), admin action buttons, upload
CTA, and history.
**Files (likely):**
`packages/web/app/room/**/_components/SlotDetail.tsx`.
**DoD:** AC-US3, AC-US4 pass.
**Tests required:** Playwright.

---

## T-018 — Web: template admin page
Status: `[ ]`
**Scope:** Settings → Checklist templates. List per-org templates;
edit slot title / guidance / criteria / required / display_order;
add custom slot; hide slot.
**Files (likely):** `packages/web/app/settings/checklists/**/*.tsx`.
**DoD:** AC-US6 passes.
**Tests required:** Playwright.

---

## T-019 — Web: home-page completion widget
Status: `[ ]`
**Scope:** Home / room dashboard shows a progress ring per canonical
folder + per non-archived Opportunity using
`/rooms/:orgId/completion`.
**Files (likely):**
`packages/web/app/home/_components/CompletionPanel.tsx`.
**DoD:** AC-US5 passes.
**Tests required:** Playwright.

---

## T-020 — Observability: metrics
Status: `[ ]`
**Scope:** Emit the metrics named in design.md §Observability. No
alarms at v0.1.
**Files (likely):**
`microservices/core/infrastructure/metrics/checklist.ts`.
**DoD:** Metrics observable in CloudWatch; daily gauge job scheduled.
**Tests required:** Smoke.

---

## T-021 — Feature flag integration
Status: `[ ]`
**Scope:** Add `checklist_enabled` per-org feature flag. When
disabled: upload flow skips slot picker; folder pages hide slot
rows and just list documents; seeding still happens (forward
compatibility). Default ON in prod.
**Files (likely):**
`microservices/core/application/feature-flags.ts` (extend),
`packages/web/app/_lib/featureFlags.ts`.
**DoD:** Toggling off cleanly hides the slice without breakage.
**Tests required:** Integration + Playwright.

---

## T-022 — NFR hardening pass
Status: `[ ]`
**Scope:** Verify NFR1 (completion p95 ≤100ms), NFR2 (no
cross-tenant template reads — property test), NFR3 (template
customisation is per-org, never touches canonical code), NFR4
(audit log for every template edit).
**Files (likely):** `tests/security/checklist-nfr-matrix.spec.ts`.
**DoD:** Matrix green in CI.

---

## T-023 — Playwright acceptance suite
Status: `[ ]`
**Scope:** One spec per AC-US1–AC-US6.
**Files (likely):** `tests/e2e/doc-checklist/*.spec.ts`.
**DoD:** All 6 specs green on e2e.

---

## T-024 — Slice sign-off + ADR-006
Status: `[ ]`
**Scope:** Draft ADR-006 (template snapshot per-org) linked from
design.md. Traceability matrix. Tag `v0.4.0-doc-checklist`.
**Files (likely):** `adr/006-template-snapshot-per-org.md`,
`docs/slices/doc-checklist.md`.
**DoD:** ADR + matrix merged; tag pushed.

---

## Dependencies

```
T-001 ─► T-005 ─► T-006 ─► T-007 ──► T-013 ─► T-015/16/17/18/19
         ▲        ▲        ▲         ▲
T-002 ──►│        │        │         │
T-003 ──►│        │        │         │
T-004 ──►│        │        │         │
                  │        │         │
                  ├► T-008 ┤         │
                  ├► T-009 ┤         │
                  ├► T-010 ┤         │
                  ├► T-011 ┤         │
                  └► T-012 ┤         │
                           └► T-014 ─┘

T-020, T-021, T-022 in parallel after T-013
T-023 after T-015–T-019
T-024 last
```

Parallelisable after T-005:
- T-008 / T-009 / T-010 / T-011 / T-012 — independent application units.
- Web tasks (T-015–T-019) after T-013.

## Acceptance for the slice
1. All AC-US* in `requirements.md` pass in Playwright.
2. T-024 traceability + ADR-006 merged.
3. Curtis has signed off on the canonical template content (T-003).
4. `v0.4.0-doc-checklist` tagged.
