import { renderHook, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { vi } from "vitest";

const { getRoom } = vi.hoisted(() => ({ getRoom: vi.fn() }));

vi.mock("@/lib/eden", () => ({
  api: {
    core: {
      orgs: () => ({
        rooms: {
          get: getRoom,
        },
      }),
    },
  },
}));

import { useGetRoom } from "../useGetRoom";

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}

beforeEach(() => {
  getRoom.mockReset();
});

describe("useGetRoom", () => {
  it("returns the room payload on a 200", async () => {
    getRoom.mockResolvedValue({
      status: 200,
      data: {
        folders: ["01_Company_Overview", "02_Financials"],
        opportunities: [],
      },
    });

    const { result } = renderHook(() => useGetRoom("org-1"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(result.current.room?.folders).toEqual([
      "01_Company_Overview",
      "02_Financials",
    ]);
    expect(result.current.isError).toBe(false);
  });

  it("treats a non-200 response as an error without a room payload", async () => {
    getRoom.mockResolvedValue({
      status: 401,
      data: { ok: false, reason: "no_session" },
    });

    const { result } = renderHook(() => useGetRoom("org-1"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(result.current.room).toBeUndefined();
    expect(result.current.isError).toBe(true);
  });

  it("stays disabled (no fetch) when orgId is undefined", () => {
    const { result } = renderHook(() => useGetRoom(undefined), {
      wrapper: createWrapper(),
    });

    expect(getRoom).not.toHaveBeenCalled();
    expect(result.current.status).toBe("pending");
    expect(result.current.room).toBeUndefined();
  });
});
