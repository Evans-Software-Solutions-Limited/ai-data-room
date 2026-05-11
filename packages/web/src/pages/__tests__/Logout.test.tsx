import { render, screen } from "@testing-library/react";
import { vi } from "vitest";

import Logout from "../Logout";

vi.mock("@/constants/authUrls", () => ({
  getAuthSignOutHref: () => "http://api.test/auth/sign-out",
}));

const assign = vi.fn();

beforeEach(() => {
  vi.stubGlobal("location", { ...window.location, assign });
});

afterEach(() => {
  vi.unstubAllGlobals();
  assign.mockReset();
});

describe("Logout", () => {
  it("hands the user off to /auth/sign-out via full-page navigation on mount", () => {
    render(<Logout />);

    expect(assign).toHaveBeenCalledWith("http://api.test/auth/sign-out");
    expect(screen.getByText(/Signing out/)).toBeDefined();
  });
});
