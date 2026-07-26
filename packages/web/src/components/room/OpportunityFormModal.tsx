import { useEffect, useState } from "react";
import { OpportunitySlugSchema } from "@ai-data-room/api-utils/schemas/rooms";

import { CloseIcon } from "@/components/room/icons";
import type { OpportunityMutationReason } from "@/hooks/api/useOpportunityMutations";

// Create/rename form modal for Opportunity subrooms — room-and-folders
// (slice 2), T-015. One presenter for both modes (mirrors the design
// prototype's single form, minus every access-control/AI affordance —
// see the T-015 build spec's STRICT slice-2 scope note). Modal shell
// mirrors `UploadModal.tsx`'s idiom exactly (scrim + `role="dialog"`
// panel, scrim-click + Escape to close).

const SLUG_HINT = "Letters, digits, underscore or hyphen; 1–64 chars.";

export interface OpportunityFormModalProps {
  open: boolean;
  mode: "create" | "rename";
  initialSlug?: string;
  initialName?: string;
  pending: boolean;
  errorReason?: OpportunityMutationReason;
  onClose: () => void;
  onSubmit: (values: { slug: string; name?: string }) => void;
}

function serverErrorCopy(
  mode: "create" | "rename",
  reason: OpportunityMutationReason | undefined,
): string | null {
  switch (reason) {
    case "slug_taken":
      return "An opportunity with that slug already exists.";
    case "invalid_slug":
      return SLUG_HINT;
    case "not_found":
      return mode === "rename"
        ? "That opportunity no longer exists."
        : "Something went wrong. Try again.";
    case "already_archived":
    case "unknown":
      return "Something went wrong. Try again.";
    default:
      return null;
  }
}

export function OpportunityFormModal({
  open,
  mode,
  initialSlug,
  initialName,
  pending,
  errorReason,
  onClose,
  onSubmit,
}: OpportunityFormModalProps) {
  // Seeded once from the initial props. Reseeding when the modal
  // (re)opens for different prefill values (e.g. "rename" on a different
  // opportunity) is the caller's job via a `key` that changes with
  // `mode`/the selected opportunity — see the callsite in `Room.tsx` —
  // rather than resetting state from an effect (React's set-state-in-
  // effect lint rule flags synchronous `setState` in an effect body as a
  // cascading-render risk; a remount sidesteps it entirely).
  const [slug, setSlug] = useState(initialSlug ?? "");
  const [name, setName] = useState(initialName ?? "");

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const slugValidation = OpportunitySlugSchema.safeParse(slug);
  const slugInvalid = !slugValidation.success;
  const submitDisabled = pending || slug.length === 0 || slugInvalid;

  const errorMessage = serverErrorCopy(mode, errorReason);

  function handleScrimMouseDown(event: React.MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) {
      onClose();
    }
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitDisabled) return;
    onSubmit({ slug, name: name.trim() || undefined });
  }

  const title = mode === "create" ? "New opportunity" : "Rename opportunity";
  const submitLabel = mode === "create" ? "Create" : "Save";

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-room-ink/40 p-4"
      onMouseDown={handleScrimMouseDown}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onSubmit={handleSubmit}
        className="flex w-full max-w-[480px] flex-col gap-5 rounded-room-lg border border-room-rule bg-room-card p-6 shadow-room-2"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="font-room-serif text-xl text-room-ink">{title}</h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="rounded-room p-1 text-room-ink-3 hover:bg-room-paper-3 hover:text-room-ink"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="opportunity-slug"
            className="text-sm font-medium text-room-ink"
          >
            Slug
          </label>
          <input
            id="opportunity-slug"
            type="text"
            value={slug}
            onChange={(event) => setSlug(event.target.value)}
            className="rounded-room border border-room-rule bg-room-paper px-3 py-1.5 text-sm text-room-ink outline-none focus:border-room-ink-3"
          />
          <p
            className={
              slugInvalid && slug.length > 0
                ? "text-xs text-room-err"
                : "text-xs text-room-ink-3"
            }
          >
            {SLUG_HINT}
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="opportunity-name"
            className="text-sm font-medium text-room-ink"
          >
            Display name
          </label>
          <input
            id="opportunity-name"
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="rounded-room border border-room-rule bg-room-paper px-3 py-1.5 text-sm text-room-ink outline-none focus:border-room-ink-3"
          />
        </div>

        {errorMessage && (
          <p className="text-sm text-room-err">{errorMessage}</p>
        )}

        <div className="flex justify-end gap-2 border-t border-room-rule pt-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-room-pill border border-room-rule px-4 py-1.5 text-sm text-room-ink hover:bg-room-paper-3"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitDisabled}
            className="rounded-room-pill border border-room-rule bg-room-ink px-4 py-1.5 text-sm font-medium text-room-ink-on-dark hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
