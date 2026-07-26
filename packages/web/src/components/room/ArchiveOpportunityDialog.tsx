import { useEffect } from "react";

import type { OpportunityMutationReason } from "@/hooks/api/useOpportunityMutations";

// Archive confirmation dialog for an Opportunity subroom —
// room-and-folders (slice 2), T-015. Deliberately room-styled (NOT
// shadcn's `AlertDialog`, which would clash with the ink-on-paper
// shell) — same scrim + `role="dialog"` panel idiom as `UploadModal`
// and `OpportunityFormModal`.

export interface ArchiveOpportunityDialogProps {
  open: boolean;
  opportunityName: string;
  pending: boolean;
  errorReason?: OpportunityMutationReason;
  onClose: () => void;
  onConfirm: () => void;
}

function errorCopy(
  reason: OpportunityMutationReason | undefined,
): string | null {
  switch (reason) {
    case "already_archived":
      return "This opportunity is already archived.";
    case "not_found":
      return "That opportunity no longer exists.";
    case "invalid_slug":
    case "slug_taken":
    case "unknown":
      return "Something went wrong. Try again.";
    default:
      return null;
  }
}

export function ArchiveOpportunityDialog({
  open,
  opportunityName,
  pending,
  errorReason,
  onClose,
  onConfirm,
}: ArchiveOpportunityDialogProps) {
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

  function handleScrimMouseDown(event: React.MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) {
      onClose();
    }
  }

  const message = errorCopy(errorReason);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-room-ink/40 p-4"
      onMouseDown={handleScrimMouseDown}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Archive ${opportunityName}?`}
        className="flex w-full max-w-[480px] flex-col gap-4 rounded-room-lg border border-room-rule bg-room-card p-6 shadow-room-2"
      >
        <h2 className="font-room-serif text-xl text-room-ink">
          Archive {opportunityName}?
        </h2>
        <p className="text-sm text-room-ink-2">
          Its documents are hidden from the room and any external access is
          revoked. Archived subrooms are retained for 90 days before deletion.
        </p>

        {message && <p className="text-sm text-room-err">{message}</p>}

        <div className="flex justify-end gap-2 border-t border-room-rule pt-4">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="rounded-room-pill border border-room-rule px-4 py-1.5 text-sm text-room-ink hover:bg-room-paper-3 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className="rounded-room-pill border border-room-warn px-4 py-1.5 text-sm font-medium text-room-warn hover:bg-room-warn-tint disabled:cursor-not-allowed disabled:opacity-50"
          >
            Archive
          </button>
        </div>
      </div>
    </div>
  );
}
