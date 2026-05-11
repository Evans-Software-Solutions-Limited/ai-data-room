import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";

import { NavBar } from "../NavBar";

const props = {
  signInHref: "http://api.test/auth/sign-in",
  signUpHref: "http://api.test/auth/sign-up",
  signOutHref: "http://api.test/auth/sign-out",
};

describe("NavBar", () => {
  it("renders sign-in and sign-up anchors for anonymous visitors", () => {
    render(
      <MemoryRouter>
        <NavBar {...props} isAuthenticated={false} />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole("link", { name: "Sign in" }).getAttribute("href"),
    ).toBe("http://api.test/auth/sign-in");
    expect(
      screen.getByRole("link", { name: "Sign up" }).getAttribute("href"),
    ).toBe("http://api.test/auth/sign-up");
    expect(screen.queryByRole("link", { name: "Sign out" })).toBeNull();
  });

  it("renders display name + sign-out for authenticated visitors", () => {
    render(
      <MemoryRouter>
        <NavBar
          {...props}
          isAuthenticated
          userDisplayName="Ada Lovelace"
          userEmail="ada@example.com"
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("Ada Lovelace")).toBeDefined();
    expect(
      screen.getByRole("link", { name: "Sign out" }).getAttribute("href"),
    ).toBe("http://api.test/auth/sign-out");
    expect(screen.queryByRole("link", { name: "Sign in" })).toBeNull();
  });

  it("falls back to email when no display name is provided", () => {
    render(
      <MemoryRouter>
        <NavBar {...props} isAuthenticated userEmail="fallback@example.com" />
      </MemoryRouter>,
    );

    expect(screen.getByText("fallback@example.com")).toBeDefined();
  });
});
