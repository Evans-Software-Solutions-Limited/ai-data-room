import { render, screen } from "@testing-library/react";
import { vi } from "vitest";

import Login from "../Login";

vi.mock("@/constants/authUrls", () => ({
  getAuthSignInHref: () => "http://api.test/auth/sign-in",
}));

const assign = vi.fn();

beforeEach(() => {
  vi.stubGlobal("location", {
    ...window.location,
    assign,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  assign.mockReset();
});

describe("Login", () => {
  it("hands the user off to /auth/sign-in via full-page navigation on mount", () => {
    render(<Login />);

    expect(assign).toHaveBeenCalledWith("http://api.test/auth/sign-in");
    expect(screen.getByText(/Redirecting/)).toBeDefined();
  });
});
