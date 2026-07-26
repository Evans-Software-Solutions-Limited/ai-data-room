import { useMutation, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/eden";

// Soft-delete / restore / request-download mutations for the document
// detail modal — room-and-folders (slice 2), T-016. Mirrors
// `useOpportunityMutations.ts`'s shared error-reason + invalidation
// idiom.

export type DocumentMutationReason =
  | "not_found"
  | "invalid_state"
  | "retention_expired"
  | "unknown";

const KNOWN_REASONS: readonly DocumentMutationReason[] = [
  "not_found",
  "invalid_state",
  "retention_expired",
];

export class DocumentMutationError extends Error {
  reason: DocumentMutationReason;

  constructor(reason: DocumentMutationReason) {
    super(reason);
    this.name = "DocumentMutationError";
    this.reason = reason;
  }
}

/** Best-effort extraction of a known `reason` string from a response
 *  body. Returns `undefined` for anything malformed or unrecognised —
 *  callers fold that into `"unknown"`. */
function extractReason(body: unknown): DocumentMutationReason | undefined {
  if (body && typeof body === "object" && "reason" in body) {
    const reason = (body as { reason: unknown }).reason;
    if (
      typeof reason === "string" &&
      (KNOWN_REASONS as readonly string[]).includes(reason)
    ) {
      return reason as DocumentMutationReason;
    }
  }
  return undefined;
}

/** eden resolves a non-2xx WITHOUT throwing: the error body can surface
 *  as `res.data` or as `res.error.value` — check both (same rationale
 *  as `useOpportunityMutations.ts`'s `reasonFrom`). */
function reasonFrom(res: {
  data?: unknown;
  error?: unknown;
}): DocumentMutationReason {
  const errorValue =
    res.error && typeof res.error === "object" && "value" in res.error
      ? (res.error as { value: unknown }).value
      : undefined;
  return extractReason(res.data) ?? extractReason(errorValue) ?? "unknown";
}

export function useSoftDeleteDocument(orgId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id }: { id: string }): Promise<void> => {
      const res = await api.core.orgs({ orgId }).documents({ id }).delete();
      if (res.status !== 200) {
        throw new DocumentMutationError(reasonFrom(res));
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["folderContents", orgId],
      });
    },
  });
}

export function useRestoreDocument(orgId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id }: { id: string }): Promise<void> => {
      const res = await api.core
        .orgs({ orgId })
        .documents({ id })
        .restore.post();
      if (res.status !== 200) {
        throw new DocumentMutationError(reasonFrom(res));
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["folderContents", orgId],
      });
    },
  });
}

/** Fetches a short-lived presigned download URL for a document's
 *  current (or a specific past) version. This is a `useMutation`
 *  rather than a query so a click can show pending state and surface
 *  an error — and, more importantly, so the underlying `getDocument`
 *  call (which audits a `file_downloaded` event server-side on every
 *  invocation) only ever fires on a deliberate user action, never as
 *  an incidental effect of the modal rendering. NO cache invalidation:
 *  a download doesn't change any listing data. */
export function useRequestDownload(orgId: string) {
  return useMutation({
    mutationFn: async ({
      id,
      versionId,
    }: {
      id: string;
      versionId?: string;
    }): Promise<string> => {
      const res = await api.core
        .orgs({ orgId })
        .documents({ id })
        .get({ query: { versionId } });
      if (res.status !== 200 || !res.data) {
        throw new DocumentMutationError(reasonFrom(res));
      }
      return res.data.downloadUrl;
    },
  });
}
