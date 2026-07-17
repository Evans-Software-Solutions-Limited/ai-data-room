import { useEffect, useState } from "react";

import { CheckIcon, CloseIcon, UploadIcon } from "@/components/room/icons";
import type { UploadEntry } from "@/lib/upload/uploadRegistry";
import { cn } from "@/lib/utils";

// The `/room` upload modal — room-and-folders (slice 2), T-014. Pure
// presenter (container/presenter split): `useUploadDocuments` owns all
// the logic (transport, registry, cache invalidation); this component
// only renders the dropzone + per-file progress list from props and
// forwards user actions back up via callbacks.
//
// STRICT slice-2 scope — see the T-014 build spec. This deliberately
// does NOT render an AI relevance verdict, a required-documents
// checklist, or a "move to folder" affordance (those are slices 4/5);
// it's pick → upload with progress → plain "Added" success.

const IN_PROGRESS_STATUSES: ReadonlyArray<UploadEntry["status"]> = [
  "initiating",
  "uploading",
  "completing",
];

export interface UploadModalProps {
  open: boolean;
  targetLabel: string;
  uploads: UploadEntry[];
  onClose: () => void;
  onFilesSelected: (files: File[]) => void;
  onCancelUpload: (id: string) => void;
  onDismiss: (id: string) => void;
}

function progressPercent(entry: UploadEntry): number {
  if (entry.sizeBytes <= 0) return 0;
  return Math.min(
    100,
    Math.round((entry.bytesUploaded / entry.sizeBytes) * 100),
  );
}

export function UploadModal({
  open,
  targetLabel,
  uploads,
  onClose,
  onFilesSelected,
  onCancelUpload,
  onDismiss,
}: UploadModalProps) {
  const [dragOver, setDragOver] = useState(false);

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

  function handleFileInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    const files = event.target.files;
    if (files && files.length > 0) {
      onFilesSelected([...files]);
    }
    // Reset so picking the exact same file again still fires onChange.
    event.target.value = "";
  }

  function handleDrop(event: React.DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragOver(false);
    const files = event.dataTransfer.files;
    if (files.length > 0) {
      onFilesSelected([...files]);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-room-ink/40 p-4"
      onMouseDown={handleScrimMouseDown}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Upload to ${targetLabel}`}
        className="flex w-full max-w-[560px] flex-col gap-5 rounded-room-lg border border-room-rule bg-room-card p-6 shadow-room-2"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-room-serif text-xl text-room-ink">
              Upload to {targetLabel}
            </h2>
            <p className="mt-1 text-sm text-room-ink-2">
              Documents are encrypted at rest.
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

        {/* A <label> wrapping the (visually hidden, but focusable and in
            the tab order) file input gets click-to-browse AND
            Tab+Enter/Space-to-open-the-file-dialog for free from native
            HTML label/control association — no manual click-forwarding
            or keydown handling needed (and no risk of the input's own
            click bubbling back into a handler on this wrapper). */}
        <label
          onDragOver={(event) => {
            event.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          className={cn(
            "flex flex-col items-center gap-2 rounded-room-lg border border-dashed px-6 py-10 text-center transition-colors",
            dragOver
              ? "border-room-ink-3 bg-room-paper-3/60"
              : "border-room-rule-strong hover:border-room-ink-3",
          )}
        >
          <UploadIcon className="h-5 w-5 text-room-ink-3" />
          <p className="text-sm text-room-ink">
            Drop documents here, or click to browse
          </p>
          <p className="font-room-mono text-xs text-room-ink-3">
            PDF, XLSX, DOCX, PPTX, PNG, JPG, CSV, TXT · up to 100 MB
          </p>
          <input
            type="file"
            multiple
            aria-label="Choose files to upload"
            className="sr-only"
            onChange={handleFileInputChange}
          />
        </label>

        {uploads.length > 0 && (
          <ul className="flex max-h-64 flex-col gap-2 overflow-y-auto">
            {uploads.map((entry) => (
              <UploadRow
                key={entry.id}
                entry={entry}
                onCancel={() => onCancelUpload(entry.id)}
                onDismiss={() => onDismiss(entry.id)}
              />
            ))}
          </ul>
        )}

        <div className="flex justify-end border-t border-room-rule pt-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-room-pill border border-room-rule px-4 py-1.5 text-sm text-room-ink hover:bg-room-paper-3"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

function UploadRow({
  entry,
  onCancel,
  onDismiss,
}: {
  entry: UploadEntry;
  onCancel: () => void;
  onDismiss: () => void;
}) {
  const inProgress = IN_PROGRESS_STATUSES.includes(entry.status);
  const pct = progressPercent(entry);

  return (
    <li className="flex flex-col gap-1.5 rounded-room border border-room-rule bg-room-card px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <span
          className="truncate font-room-mono text-sm text-room-ink"
          title={entry.fileName}
        >
          {entry.fileName}
        </span>
        {inProgress && (
          <div className="flex shrink-0 items-center gap-2">
            <span className="font-room-mono text-xs text-room-ink-3">
              {pct}%
            </span>
            <button
              type="button"
              onClick={onCancel}
              className="text-xs text-room-ink-3 underline hover:text-room-ink"
            >
              Cancel
            </button>
          </div>
        )}
        {entry.status === "done" && (
          <div className="flex shrink-0 items-center gap-2 text-room-ok">
            <CheckIcon className="h-3.5 w-3.5" />
            <span className="text-sm">Added</span>
            <DismissButton fileName={entry.fileName} onDismiss={onDismiss} />
          </div>
        )}
        {entry.status === "error" && (
          <div className="flex shrink-0 items-center gap-2">
            <span className="text-sm text-room-err">{entry.error}</span>
            <DismissButton fileName={entry.fileName} onDismiss={onDismiss} />
          </div>
        )}
        {entry.status === "canceled" && (
          <div className="flex shrink-0 items-center gap-2">
            <span className="text-sm text-room-ink-3">Canceled</span>
            <DismissButton fileName={entry.fileName} onDismiss={onDismiss} />
          </div>
        )}
      </div>
      {inProgress && (
        <div className="h-1.5 w-full overflow-hidden rounded-room-pill bg-room-paper-3">
          <div
            className="h-full rounded-room-pill bg-room-ink transition-[width]"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </li>
  );
}

function DismissButton({
  fileName,
  onDismiss,
}: {
  fileName: string;
  onDismiss: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={`Dismiss ${fileName}`}
      onClick={onDismiss}
      className="text-room-ink-3 hover:text-room-ink"
    >
      <CloseIcon className="h-3 w-3" />
    </button>
  );
}
