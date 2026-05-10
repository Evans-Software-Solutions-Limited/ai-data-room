import { render, screen } from "@testing-library/react";
import { vi } from "vitest";
import { MemoryRouter } from "react-router";

import Mfa from "../Mfa";

vi.mock("@/constants/authUrls", () => ({
  getAuthSignInHref: () => "http://api.test/auth/sign-in",
}));

describe("Mfa", () => {
  it("explains AuthKit-owned enrolment and offers sign-in", () => {
    render(
      <MemoryRouter>
        <Mfa />
      </MemoryRouter>,
    );

    expect(screen.getByText(/AuthKit/i)).toBeDefined();
    expect(screen.getByText(/ADR-003/)).toBeDefined();
    expect(
      screen
        .getByRole("link", { name: /Sign in to enrol/i })
        .getAttribute("href"),
    ).toBe("http://api.test/auth/sign-in");
  });
});
