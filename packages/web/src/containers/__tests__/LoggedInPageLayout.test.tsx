import { render, screen } from "@testing-library/react";
import { vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";

import LoggedInPageLayout from "../LoggedInPageLayout";
import { useGetCurrentUser } from "@/hooks/api/useGetCurrentUser";

vi.mock("@/hooks/api/useGetCurrentUser");
vi.mock("@/constants/authUrls", () => ({
  getAuthSignInHref: () => "http://api.test/auth/sign-in",
  getAuthSignUpHref: () => "http://api.test/auth/sign-up",
  getAuthSignOutHref: () => "http://api.test/auth/sign-out",
}));

const mockUseGetCurrentUser = vi.mocked(useGetCurrentUser);

afterEach(() => {
  vi.clearAllMocks();
});

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<LoggedInPageLayout />}>
          <Route path="/app" element={<div>Protected Content</div>} />
        </Route>
        <Route path="/" element={<div>Public Landing</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("LoggedInPageLayout", () => {
  it("shows the loader while the auth query is pending", () => {
    mockUseGetCurrentUser.mockReturnValue({
      isAuthenticated: false,
      user: undefined,

      status: "pending",
    });

    renderAt("/app");

    expect(screen.getByRole("status")).toBeDefined();
    expect(screen.queryByText("Protected Content")).toBeNull();
  });

  it("redirects unauthenticated visitors to / ", () => {
    mockUseGetCurrentUser.mockReturnValue({
      isAuthenticated: false,
      user: undefined,

      status: "success",
    });

    renderAt("/app");

    expect(screen.getByText("Public Landing")).toBeDefined();
    expect(screen.queryByText("Protected Content")).toBeNull();
  });

  it("renders the navbar + outlet for authenticated users", () => {
    mockUseGetCurrentUser.mockReturnValue({
      isAuthenticated: true,
      user: {
        userId: "u-1",
        email: "ada@example.com",
        fullName: "Ada Lovelace",
        role: "owner",
        orgId: "org-1",
        orgName: "Acme",
        opportunityScopes: [],
        emailVerified: true,
        mfaEnrolled: true,
        lifecycleState: "active",
      },

      status: "success",
    });

    renderAt("/app");

    expect(screen.getByText("Protected Content")).toBeDefined();
    expect(screen.getByText("Ada Lovelace")).toBeDefined();
    expect(
      screen.getByRole("link", { name: "Sign out" }).getAttribute("href"),
    ).toBe("http://api.test/auth/sign-out");
  });
});
