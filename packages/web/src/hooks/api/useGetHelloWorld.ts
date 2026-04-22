import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/eden";

export const useGetHelloWorld = () => {
  return useQuery({
    queryKey: ["hello-world"],
    queryFn: () => api.core["hello-world"].get().then((res) => res.data),
  });
};
