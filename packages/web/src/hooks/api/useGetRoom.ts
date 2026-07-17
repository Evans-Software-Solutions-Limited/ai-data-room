import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/eden";

// `GET /orgs/:orgId/rooms` — the seven canonical folder keys plus the
// org's live opportunities (no per-folder document counts; see the
// T-013 build spec's "No per-folder counts" note). Disabled until an
// `orgId` is known, matching the `useGetCurrentUser` → `useGetRoom`
// dependency chain in `Room.tsx`.
export const useGetRoom = (orgId: string | undefined) => {
  const { data, status } = useQuery({
    queryKey: ["room", orgId],
    queryFn: () => api.core.orgs({ orgId: orgId as string }).rooms.get(),
    enabled: Boolean(orgId),
    staleTime: 60_000,
  });

  const room = data?.status === 200 ? data.data : undefined;
  const isError = status === "error" || (data !== undefined && !room);

  return { room, status, isError };
};
