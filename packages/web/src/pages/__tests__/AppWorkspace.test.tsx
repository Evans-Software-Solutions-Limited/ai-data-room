import { render, screen } from "@testing-library/react";
import { vi } from "vitest";
import { MemoryRouter } from "react-router";

import AppWorkspace from "../AppWorkspace";
import { useGetCurrentUser } from "@/hooks/api/useGetCurrentUser";

vi.mock("@/hooks/api/useGetCurrentUser");

const mockUseGetCurrentUser = vi.mocked(useGetCurrentUser);

afterEach(() => {
  vi.clearAllMocks();
});

describe("AppWorkspace", () => {
  it("renders the unprovisioned-user placeholder when orgId is null", () => {
    mockUseGetCurrentUser.mockReturnValue({
      isAuthenticated: true,
      user: {
        userId: "u-1",
        email: "fresh@example.com",
        fullName: null,
        role: null,
        orgId: null,
        orgName: null,
        opportunityScopes: [],
        emailVerified: false,
        mfaEnrolled: false,
        lifecycleState: "active",
      },

      status: "success",
    });

    render(
      <MemoryRouter>
        <AppWorkspace />
      </MemoryRouter>,
    );

    expect(screen.getByText(/onboarding flow/i)).toBeDefined();
    expect(screen.getByText("Welcome to AI Data Room")).toBeDefined();
  });

  it("renders the /me payload for a provisioned user", () => {
    mockUseGetCurrentUser.mockReturnValue({
      isAuthenticated: true,
      user: {
        userId: "u-123",
        email: "ada@example.com",
        fullName: "Ada Lovelace",
        role: "owner",
        orgId: "org-456",
        orgName: "Acme",
        opportunityScopes: ["Opportunities/Vendor_A"],
        emailVerified: true,
        mfaEnrolled: true,
        lifecycleState: "active",
      },

      status: "success",
    });

    render(
      <MemoryRouter>
        <AppWorkspace />
      </MemoryRouter>,
    );

    expect(screen.getByText("Acme")).toBeDefined();
    expect(screen.getByText("u-123")).toBeDefined();
    expect(screen.getByText("ada@example.com")).toBeDefined();
    expect(screen.getByText("owner")).toBeDefined();
    expect(screen.getByText("Opportunities/Vendor_A")).toBeDefined();
  });

  it("returns null when the user is briefly unset (cache miss)", () => {
    mockUseGetCurrentUser.mockReturnValue({
      isAuthenticated: false,
      user: undefined,

      status: "pending",
    });

    const { container } = render(
      <MemoryRouter>
        <AppWorkspace />
      </MemoryRouter>,
    );

    expect(container.firstChild).toBeNull();
  });
});
