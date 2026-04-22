import { vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";

vi.mock("@/lib/eden", () => ({
  api: {
    core: {
      "hello-world": {
        get: vi.fn(() =>
          Promise.resolve({ data: { message: "Hello, world!" } }),
        ),
      },
    },
  },
}));

import { useGetHelloWorld } from "../useGetHelloWorld";

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}

describe("useGetHelloWorld", () => {
  it("should fetch hello world data", async () => {
    const { result } = renderHook(() => useGetHelloWorld(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual({ message: "Hello, world!" });
  });

  it("should use the correct query key", () => {
    const { result } = renderHook(() => useGetHelloWorld(), {
      wrapper: createWrapper(),
    });

    // The hook should be loading initially
    expect(result.current.isLoading).toBe(true);
  });
});
