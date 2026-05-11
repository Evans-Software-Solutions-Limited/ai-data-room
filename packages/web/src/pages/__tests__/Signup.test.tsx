import { render, screen } from "@testing-library/react";
import { vi } from "vitest";

import Signup from "../Signup";

vi.mock("@/constants/authUrls", () => ({
  getAuthSignUpHref: () => "http://api.test/auth/sign-up",
}));

const assign = vi.fn();

beforeEach(() => {
  vi.stubGlobal("location", { ...window.location, assign });
});

afterEach(() => {
  vi.unstubAllGlobals();
  assign.mockReset();
});

describe("Signup", () => {
  it("hands the user off to /auth/sign-up via full-page navigation on mount", () => {
    render(<Signup />);

    expect(assign).toHaveBeenCalledWith("http://api.test/auth/sign-up");
    expect(screen.getByText(/Redirecting/)).toBeDefined();
  });
});
