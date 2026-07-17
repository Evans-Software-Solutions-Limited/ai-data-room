import { useCallback, useRef, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/eden";
import {
  uploadFile,
  UploadClientError,
  type UploadFailureReason,
  type UploadTargetInput,
} from "@/lib/upload/uploadFile";
import { uploadRegistry, type UploadEntry } from "@/lib/upload/uploadRegistry";

// Hook glue for the `/room` upload modal — room-and-folders (slice 2),
// T-014. Wires `uploadFile` (transport) + `uploadRegistry` (per-file
// progress state) + react-query cache invalidation (so the folder
// listing refreshes on success without a manual refetch).

/** Friendly copy for each non-cancel `UploadFailureReason` — shown in the
 *  modal's error row. (`canceled` is handled separately by the caller as
 *  its own status, never surfaced as an `error` string.) */
function friendlyMessage(reason: UploadFailureReason): string {
  if (reason === "unsupported_type") {
    return "That file type isn't supported. Use PDF, DOCX, XLSX, PPTX, PNG, JPG, CSV or TXT.";
  }
  return "Upload failed. Try again.";
}

export function useUploadDocuments(orgId: string, target: UploadTargetInput) {
  const queryClient = useQueryClient();
  const uploads = useSyncExternalStore(
    uploadRegistry.subscribe,
    uploadRegistry.getAll,
  );
  // Keyed by the registry entry id — lets `cancelUpload` reach the
  // in-flight request's `AbortController` without threading it through
  // the registry (which only holds serializable-ish progress state).
  const controllersRef = useRef(new Map<string, AbortController>());

  const startUpload = useCallback(
    (file: File) => {
      const id = crypto.randomUUID();
      const controller = new AbortController();
      controllersRef.current.set(id, controller);

      uploadRegistry.register({
        id,
        fileName: file.name,
        sizeBytes: file.size,
        status: "initiating",
        bytesUploaded: 0,
      });

      uploadFile(
        { orgId, target, file },
        {
          api,
          signal: controller.signal,
          onProgress: (bytesUploaded) => {
            uploadRegistry.update(id, { status: "uploading", bytesUploaded });
          },
        },
      )
        .then(() => {
          uploadRegistry.update(id, {
            status: "done",
            bytesUploaded: file.size,
          });
          void queryClient.invalidateQueries({
            queryKey: ["folderContents", orgId],
          });
          void queryClient.invalidateQueries({ queryKey: ["room", orgId] });
        })
        .catch((err: unknown) => {
          const reason: UploadFailureReason =
            err instanceof UploadClientError ? err.reason : "complete_failed";
          uploadRegistry.update(id, {
            status: reason === "canceled" ? "canceled" : "error",
            error: reason === "canceled" ? undefined : friendlyMessage(reason),
          });
        })
        .finally(() => {
          controllersRef.current.delete(id);
        });
    },
    [orgId, target, queryClient],
  );

  const startUploads = useCallback(
    (files: File[]) => {
      files.forEach(startUpload);
    },
    [startUpload],
  );

  const cancelUpload = useCallback((id: string) => {
    controllersRef.current.get(id)?.abort();
  }, []);

  const dismiss = useCallback((id: string) => {
    uploadRegistry.remove(id);
  }, []);

  return { uploads, startUploads, cancelUpload, dismiss };
}

export type { UploadEntry };
