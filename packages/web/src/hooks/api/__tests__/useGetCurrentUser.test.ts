import { renderHook, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { vi } from "vitest";

// `vi.hoisted` so the factory below can reach `getMe` despite
// `vi.mock` being hoisted above the top-level declarations.
const { getMe } = vi.hoisted(() => ({ getMe: vi.fn() }));

vi.mock("@/lib/eden", () => ({
  api: {
    core: {
      me: {
        get: getMe,
      },
    },
  },
}));

import { useGetCurrentUser } from "../useGetCurrentUser";

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}

beforeEach(() => {
  getMe.mockReset();
});

describe("useGetCurrentUser", () => {
  it("returns isAuthenticated=true and the user payload on a 200", async () => {
    getMe.mockResolvedValue({
      status: 200,
      data: {
        userId: "user-123",
        email: "ada@example.com",
        fullName: "Ada Lovelace",
        role: "owner",
        orgId: "org-456",
        orgName: "Acme",
        opportunityScopes: [],
        emailVerified: true,
        mfaEnrolled: true,
        lifecycleState: "active",
      },
    });

    const { result } = renderHook(() => useGetCurrentUser(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.user?.userId).toBe("user-123");
    expect(result.current.user?.orgId).toBe("org-456");
  });

  it("treats a 401 response as anonymous, not a fetch error", async () => {
    getMe.mockResolvedValue({
      status: 401,
      data: { ok: false, reason: "no_session" },
    });

    const { result } = renderHook(() => useGetCurrentUser(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.user).toBeUndefined();
  });

  it("exposes a null orgId for unprovisioned users", async () => {
    getMe.mockResolvedValue({
      status: 200,
      data: {
        userId: "user-1",
        email: "freshly-signed-up@example.com",
        fullName: null,
        role: null,
        orgId: null,
        orgName: null,
        opportunityScopes: [],
        emailVerified: false,
        mfaEnrolled: false,
        lifecycleState: "active",
      },
    });

    const { result } = renderHook(() => useGetCurrentUser(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.user?.orgId).toBeNull();
  });
});
