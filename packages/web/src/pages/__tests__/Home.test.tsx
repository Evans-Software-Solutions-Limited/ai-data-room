import { render, screen } from "@testing-library/react";
import { vi } from "vitest";
import { MemoryRouter } from "react-router";

import Home from "../Home";
import { useGetCurrentUser } from "@/hooks/api/useGetCurrentUser";

vi.mock("@/hooks/api/useGetCurrentUser");
vi.mock("@/constants/authUrls", () => ({
  getAuthSignInHref: () => "http://api.test/auth/sign-in",
  getAuthSignUpHref: () => "http://api.test/auth/sign-up",
}));

const mockUseGetCurrentUser = vi.mocked(useGetCurrentUser);

afterEach(() => {
  vi.clearAllMocks();
});

describe("Home", () => {
  it("offers sign-in and sign-up affordances to anonymous visitors", () => {
    mockUseGetCurrentUser.mockReturnValue({
      isAuthenticated: false,
      user: undefined,

      status: "success",
    });

    render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>,
    );

    expect(screen.getByText("AI Data Room")).toBeDefined();
    expect(
      screen.getByRole("link", { name: "Sign in" }).getAttribute("href"),
    ).toBe("http://api.test/auth/sign-in");
    expect(
      screen.getByRole("link", { name: "Sign up" }).getAttribute("href"),
    ).toBe("http://api.test/auth/sign-up");
  });

  it("routes authenticated visitors to /app", () => {
    mockUseGetCurrentUser.mockReturnValue({
      isAuthenticated: true,
      user: {
        userId: "u-1",
        email: "ada@example.com",
        fullName: "Ada",
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

    render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>,
    );

    const link = screen.getByRole("link", { name: "Go to your workspace" });
    expect(link.getAttribute("href")).toBe("/app");
  });
});
