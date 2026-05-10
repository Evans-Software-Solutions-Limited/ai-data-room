import { vi } from "vitest";

vi.mock("@/constants/api", () => ({ CORE_API_URL: "http://api.test" }));

import {
  getAuthSignInHref,
  getAuthSignOutHref,
  getAuthSignUpHref,
} from "../authUrls";

describe("authUrls", () => {
  it("composes sign-in / sign-up / sign-out URLs against CORE_API_URL", () => {
    expect(getAuthSignInHref()).toBe("http://api.test/auth/sign-in");
    expect(getAuthSignUpHref()).toBe("http://api.test/auth/sign-up");
    expect(getAuthSignOutHref()).toBe("http://api.test/auth/sign-out");
  });
});
