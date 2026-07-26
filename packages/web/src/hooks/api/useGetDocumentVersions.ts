import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/eden";

// Version history for the document detail modal — room-and-folders
// (slice 2), T-016. Mirrors `useGetFolderContents`'s
// `{ data.status===200 ? data.data : undefined }` + `isError` shape.
//
// `getDocumentVersionsHandler` 404s on a non-active (soft-deleted)
// document, so callers gate `enabled` on the modal being open AND the
// document still being in its active view (see `DocumentDetailModal`).
export const useGetDocumentVersions = (
  orgId: string,
  documentId: string | undefined,
  enabled: boolean,
) => {
  const { data, status } = useQuery({
    queryKey: ["documentVersions", orgId, documentId],
    queryFn: () =>
      api.core
        .orgs({ orgId })
        .documents({ id: documentId as string })
        .versions.get(),
    enabled: enabled && Boolean(orgId) && Boolean(documentId),
  });

  const versions = data?.status === 200 ? data.data : undefined;
  const isError = status === "error" || (data !== undefined && !versions);

  return { versions, status, isError };
};
