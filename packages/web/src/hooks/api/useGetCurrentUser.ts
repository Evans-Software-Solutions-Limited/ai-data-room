import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/eden";

// `requireAuth` returns 401 for missing/expired sessions; the SPA
// reads that as the anonymous signal rather than a fetch error,
// hence `retry: false` (retrying just delays the redirect).
export const useGetCurrentUser = () => {
  const { data, status } = useQuery({
    queryKey: ["currentUser"],
    queryFn: () => api.core.me.get(),
    retry: false,
    staleTime: 60_000,
  });

  const isAuthenticated = status === "success" && data?.status === 200;
  const user = data?.status === 200 ? data.data : undefined;

  return { isAuthenticated, user, status };
};
