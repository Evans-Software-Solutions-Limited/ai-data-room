import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { OpportunityDTO } from "@ai-data-room/api-utils/schemas/rooms";

import { api } from "@/lib/eden";

// Create / rename / archive mutations for Opportunity subrooms —
// room-and-folders (slice 2), T-015. All three share one error-reason
// mapping and cache-invalidation shape, so they live in a single file
// (same rationale as `opportunityErrors.ts` on the server side).
//
// All three handlers return a bare `OpportunityDTO` (the server maps via
// its own `toOpportunityDTO`, mirroring `getRoom`), so eden types
// `res.data` as the DTO directly — no client-side adapter needed. (This
// used to carry a client `toOpportunityDTO` shim because the mutation
// handlers returned raw domain rows / the archive `{opportunity,...}`
// wrapper; that backend gap was closed in the opportunity-mutation-DTO
// fix.)

export type OpportunityMutationReason =
  | "invalid_slug"
  | "slug_taken"
  | "not_found"
  | "already_archived"
  | "unknown";

const KNOWN_REASONS: readonly OpportunityMutationReason[] = [
  "invalid_slug",
  "slug_taken",
  "not_found",
  "already_archived",
];

export class OpportunityMutationError extends Error {
  reason: OpportunityMutationReason;

  constructor(reason: OpportunityMutationReason) {
    super(reason);
    this.name = "OpportunityMutationError";
    this.reason = reason;
  }
}

/** Best-effort extraction of a known `reason` string from a response
 *  body. Returns `undefined` for anything malformed or unrecognised —
 *  callers fold that into `"unknown"`. */
function extractReason(body: unknown): OpportunityMutationReason | undefined {
  if (body && typeof body === "object" && "reason" in body) {
    const reason = (body as { reason: unknown }).reason;
    if (
      typeof reason === "string" &&
      (KNOWN_REASONS as readonly string[]).includes(reason)
    ) {
      return reason as OpportunityMutationReason;
    }
  }
  return undefined;
}

/** eden resolves a non-2xx WITHOUT throwing: the error body can surface
 *  as `res.data` (some handlers just return the body with `set.status`)
 *  or as `res.error.value` (elysia's `status()` helper, which is what
 *  `translateOpportunityError` uses) — check both. */
function reasonFrom(res: {
  data?: unknown;
  error?: unknown;
}): OpportunityMutationReason {
  const errorValue =
    res.error && typeof res.error === "object" && "value" in res.error
      ? (res.error as { value: unknown }).value
      : undefined;
  return extractReason(res.data) ?? extractReason(errorValue) ?? "unknown";
}

export function useCreateOpportunity(orgId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      slug,
      name,
    }: {
      slug: string;
      name?: string;
    }): Promise<OpportunityDTO> => {
      const res = await api.core.orgs({ orgId }).opportunities.post({
        slug,
        name,
      });
      if (res.status !== 201 || !res.data) {
        throw new OpportunityMutationError(reasonFrom(res));
      }
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["room", orgId] });
    },
  });
}

export function useRenameOpportunity(orgId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      slug,
      name,
    }: {
      id: string;
      slug: string;
      name?: string;
    }): Promise<OpportunityDTO> => {
      const res = await api.core
        .orgs({ orgId })
        .opportunities({ id })
        .patch({ slug, name });
      if (res.status !== 200 || !res.data) {
        throw new OpportunityMutationError(reasonFrom(res));
      }
      return res.data;
    },
    onSuccess: () => {
      // The folder pane shows the opportunity's name/slug as an eyebrow,
      // so a rename needs both cache keys invalidated, not just `room`.
      void queryClient.invalidateQueries({ queryKey: ["room", orgId] });
      void queryClient.invalidateQueries({
        queryKey: ["folderContents", orgId],
      });
    },
  });
}

export function useArchiveOpportunity(orgId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id }: { id: string }): Promise<OpportunityDTO> => {
      const res = await api.core
        .orgs({ orgId })
        .opportunities({ id })
        .archive.post();
      if (res.status !== 200 || !res.data) {
        throw new OpportunityMutationError(reasonFrom(res));
      }
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["room", orgId] });
      void queryClient.invalidateQueries({
        queryKey: ["folderContents", orgId],
      });
    },
  });
}
