import { useEffect, useState } from "react";
import type { DocumentDTO } from "@ai-data-room/api-utils/schemas/rooms";

import { CloseIcon } from "@/components/room/icons";
import {
  DocumentMutationError,
  useRequestDownload,
  useRestoreDocument,
  useSoftDeleteDocument,
} from "@/hooks/api/useDocumentMutations";
import { useGetDocumentVersions } from "@/hooks/api/useGetDocumentVersions";
import { canonicalFolderLabel } from "@/lib/canonicalFolderLabel";
import { formatBytes } from "@/lib/formatBytes";
import { formatDate } from "@/lib/formatDate";

// Document detail modal — room-and-folders (slice 2), T-016. Shows a
// document's metadata + version history, and (owner/editor only)
// soft-delete + in-session restore. Modal shell mirrors
// `UploadModal.tsx`'s idiom exactly (scrim + `role="dialog"` panel,
// scrim-click + Escape to close).
//
// STRICT slice-2 scope — see the T-016 build spec. No AI sense-check,
// no checklist, no redaction/watermark/OCR, no external-viewer /
// access-control affordances: metadata + version history + download +
// soft-delete + in-session restore only.
//
// CRITICAL: `getDocument` (the eden call behind `useRequestDownload`)
// AUDITS a `file_downloaded` event on every call server-side. This
// component therefore never calls it just to render — the header
// renders straight off the `document` prop, which is the DTO already
// loaded by the folder listing. `useRequestDownload` fires only from
// an explicit Download click.
//
// CRITICAL: there is no "deleted documents" list endpoint, and both
// `getDocument` and `listVersions` 404 on a non-active (soft-deleted)
// document. So once a document is soft-deleted, it's only reachable
// here for the remainder of THIS modal session — the local `deleted`
// flag below, set on a successful delete, is the only place "deleted +
// restorable" state lives. Closing the modal on a deleted document
// loses that in-session state; the doc becomes unreachable in the UI
// until restored (server-side, the 30-day retention window is still
// enforced regardless). A persistent deleted-items bin needs a backend
// list endpoint, which is out of slice-2 scope.
export interface DocumentDetailModalProps {
  open: boolean;
  document: DocumentDTO | null;
  orgId: string;
  canWrite: boolean;
  onClose: () => void;
}

function folderLabel(document: DocumentDTO): string {
  return document.folder.kind === "canonical"
    ? canonicalFolderLabel(document.folder.folder).name
    : `Opportunity · ${document.folder.slug}`;
}

function restoreErrorCopy(
  reason: DocumentMutationError["reason"] | undefined,
): string | null {
  switch (reason) {
    case "retention_expired":
      return "The 30-day restore window has passed.";
    case "not_found":
      return "This document no longer exists.";
    case "invalid_state":
    case "unknown":
      return "Something went wrong. Try again.";
    default:
      return null;
  }
}

export function DocumentDetailModal({
  open,
  document,
  orgId,
  canWrite,
  onClose,
}: DocumentDetailModalProps) {
  const [deleted, setDeleted] = useState(false);

  const versionsEnabled = open && document !== null && !deleted;
  const {
    versions,
    status: versionsStatus,
    isError: versionsIsError,
  } = useGetDocumentVersions(orgId, document?.id, versionsEnabled);

  const requestDownload = useRequestDownload(orgId);
  const softDeleteDocument = useSoftDeleteDocument(orgId);
  const restoreDocumentMutation = useRestoreDocument(orgId);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    window.document.addEventListener("keydown", handleKeyDown);
    return () => window.document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open || !document) return null;

  function handleScrimMouseDown(event: React.MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) {
      onClose();
    }
  }

  function handleDownload(versionId?: string) {
    if (!document) return;
    requestDownload.mutate(
      { id: document.id, versionId },
      {
        onSuccess: (downloadUrl) => {
          window.open(downloadUrl, "_blank", "noopener,noreferrer");
        },
      },
    );
  }

  function handleDelete() {
    if (!document) return;
    softDeleteDocument.mutate(
      { id: document.id },
      { onSuccess: () => setDeleted(true) },
    );
  }

  function handleRestore() {
    if (!document) return;
    restoreDocumentMutation.mutate(
      { id: document.id },
      { onSuccess: () => setDeleted(false) },
    );
  }

  const restoreErrorReason =
    restoreDocumentMutation.error instanceof DocumentMutationError
      ? restoreDocumentMutation.error.reason
      : undefined;
  const restoreMessage = restoreErrorCopy(restoreErrorReason);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-room-ink/40 p-4"
      onMouseDown={handleScrimMouseDown}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={document.displayName}
        className="flex w-full max-w-[640px] flex-col gap-5 rounded-room-lg border border-room-rule bg-room-card p-6 shadow-room-2"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-room-serif text-xl text-room-ink">
              {document.displayName}
            </h2>
            <p className="mt-1 text-sm text-room-ink-2">
              {folderLabel(document)} · v{document.currentVersion.versionNumber}{" "}
              · {formatBytes(document.currentVersion.sizeBytes)} · Uploaded{" "}
              {formatDate(document.currentVersion.uploadedAt)}
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="rounded-room p-1 text-room-ink-3 hover:bg-room-paper-3 hover:text-room-ink"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>

        {deleted ? (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-room-ink-2">
              This document was deleted and is hidden from the room. You can
              restore it within 30 days.
            </p>
            {restoreMessage && (
              <p className="text-sm text-room-err">{restoreMessage}</p>
            )}
            {canWrite && (
              <div>
                <button
                  type="button"
                  onClick={handleRestore}
                  disabled={restoreDocumentMutation.isPending}
                  className="rounded-room-pill border border-room-rule bg-room-ink px-4 py-1.5 text-sm font-medium text-room-ink-on-dark hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Restore
                </button>
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleDownload()}
                disabled={requestDownload.isPending}
                className="rounded-room-pill border border-room-rule bg-room-ink px-4 py-1.5 text-sm font-medium text-room-ink-on-dark hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Download
              </button>
              {canWrite && (
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={softDeleteDocument.isPending}
                  className="rounded-room-pill border border-room-rule px-4 py-1.5 text-sm text-room-ink hover:bg-room-paper-3 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Delete
                </button>
              )}
            </div>

            {requestDownload.isError && (
              <p className="text-sm text-room-err">
                Couldn't get the download link.
              </p>
            )}
            {softDeleteDocument.isError && (
              <p className="text-sm text-room-err">
                Couldn't delete this document.
              </p>
            )}

            <div>
              <h3 className="text-xs font-semibold tracking-wide text-room-ink-3 uppercase">
                Version history
              </h3>
              <div className="mt-2">
                {versionsStatus === "pending" ? (
                  <p className="py-4 text-sm text-room-ink-3">Loading…</p>
                ) : versionsIsError ? (
                  <p className="py-4 text-sm text-room-ink-2">
                    Couldn't load version history.
                  </p>
                ) : (
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-room-rule text-left text-xs tracking-wide text-room-ink-3 uppercase">
                        <th className="py-2 pr-4 font-normal">Version</th>
                        <th className="py-2 pr-4 font-normal">Filename</th>
                        <th className="py-2 pr-4 font-normal">Size</th>
                        <th className="py-2 pr-4 font-normal">Uploaded</th>
                        <th className="py-2 font-normal" />
                      </tr>
                    </thead>
                    <tbody>
                      {versions?.map((version) => (
                        <tr
                          key={version.id}
                          className="border-b border-room-rule-2 last:border-0"
                        >
                          <td className="py-2 pr-4 font-room-mono text-room-ink">
                            v{version.versionNumber}
                            {version.id === document.currentVersion.id &&
                              " (current)"}
                          </td>
                          <td
                            className="max-w-0 truncate py-2 pr-4 text-room-ink"
                            title={version.originalFilename}
                          >
                            {version.originalFilename}
                          </td>
                          <td className="py-2 pr-4 font-room-mono text-room-ink-2">
                            {formatBytes(version.sizeBytes)}
                          </td>
                          <td className="py-2 pr-4 font-room-mono text-room-ink-2">
                            {formatDate(version.uploadedAt)}
                          </td>
                          <td className="py-2 text-right">
                            <button
                              type="button"
                              onClick={() => handleDownload(version.id)}
                              disabled={requestDownload.isPending}
                              className="text-xs text-room-ink-3 underline hover:text-room-ink disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Download
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </>
        )}

        <div className="flex justify-end border-t border-room-rule pt-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-room-pill border border-room-rule px-4 py-1.5 text-sm text-room-ink hover:bg-room-paper-3"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
