import { render, screen } from "@testing-library/react";
import { vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";

import LoggedOutPageLayout from "../LoggedOutPageLayout";
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

function renderRoot() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route element={<LoggedOutPageLayout />}>
          <Route path="/" element={<div>Public Landing</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe("LoggedOutPageLayout", () => {
  it("shows the loader while the auth query is pending", () => {
    mockUseGetCurrentUser.mockReturnValue({
      isAuthenticated: false,
      user: undefined,

      status: "pending",
    });

    renderRoot();

    expect(screen.getByRole("status")).toBeDefined();
  });

  it("renders the anonymous navbar variant for unauthenticated visitors", () => {
    mockUseGetCurrentUser.mockReturnValue({
      isAuthenticated: false,
      user: undefined,

      status: "success",
    });

    renderRoot();

    expect(screen.getByText("Public Landing")).toBeDefined();
    expect(
      screen.getByRole("link", { name: "Sign in" }).getAttribute("href"),
    ).toBe("http://api.test/auth/sign-in");
    expect(screen.queryByRole("link", { name: "Sign out" })).toBeNull();
  });

  it("renders the authenticated navbar variant when a user is signed in", () => {
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

    renderRoot();

    expect(screen.getByText("Ada Lovelace")).toBeDefined();
    expect(
      screen.getByRole("link", { name: "Sign out" }).getAttribute("href"),
    ).toBe("http://api.test/auth/sign-out");
  });
});
