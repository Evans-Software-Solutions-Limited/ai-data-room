import { useQuery } from "@tanstack/react-query";
import type { CanonicalFolder } from "@ai-data-room/api-utils/schemas/rooms";

import { api } from "@/lib/eden";

// A folder-detail pane can show either a canonical folder or an
// Opportunity subroom — the two are different backend endpoints
// (`GET /rooms/folders/:canonical` vs `GET /opportunities/:id/documents`)
// but return the same `FolderListingDTO` shape, so one hook covers both.
export type FolderTarget =
  | { kind: "canonical"; folder: CanonicalFolder }
  | { kind: "opportunity"; id: string };

export const useGetFolderContents = (
  orgId: string | undefined,
  target: FolderTarget | undefined,
) => {
  const enabled = Boolean(orgId) && Boolean(target);

  const { data, status } = useQuery({
    queryKey: ["folderContents", orgId, target],
    queryFn: () => {
      const org = orgId as string;
      const selected = target as FolderTarget;
      return selected.kind === "canonical"
        ? api.core
            .orgs({ orgId: org })
            .rooms.folders({ canonical: selected.folder })
            .get()
        : api.core
            .orgs({ orgId: org })
            .opportunities({ id: selected.id })
            .documents.get();
    },
    enabled,
    staleTime: 30_000,
  });

  const listing = data?.status === 200 ? data.data : undefined;
  const isError = status === "error" || (data !== undefined && !listing);

  return { listing, status, isError };
};
