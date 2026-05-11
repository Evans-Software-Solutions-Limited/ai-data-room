import { render, screen } from "@testing-library/react";
import { vi } from "vitest";
import { MemoryRouter } from "react-router";

import App from "../App";

vi.mock("../pages/Home", () => ({
  default: () => <div>Home Page</div>,
}));
vi.mock("../pages/Login", () => ({
  default: () => <div>Login Page</div>,
}));
vi.mock("../pages/Signup", () => ({
  default: () => <div>Signup Page</div>,
}));
vi.mock("../pages/Logout", () => ({
  default: () => <div>Logout Page</div>,
}));
vi.mock("../pages/Mfa", () => ({
  default: () => <div>Mfa Page</div>,
}));
vi.mock("../pages/AppWorkspace", () => ({
  default: () => <div>AppWorkspace Page</div>,
}));

vi.mock("../containers/LoggedInPageLayout", async () => {
  const { Outlet } = await import("react-router");
  return { default: () => <Outlet /> };
});
vi.mock("../containers/LoggedOutPageLayout", async () => {
  const { Outlet } = await import("react-router");
  return { default: () => <Outlet /> };
});

Object.defineProperty(window, "localStorage", {
  value: {
    getItem: vi.fn(() => null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
  },
});

Object.defineProperty(window, "matchMedia", {
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

describe("App", () => {
  it.each([
    ["/", "Home Page"],
    ["/login", "Login Page"],
    ["/signup", "Signup Page"],
    ["/logout", "Logout Page"],
    ["/mfa", "Mfa Page"],
    ["/app", "AppWorkspace Page"],
  ])("renders %s", (path, text) => {
    render(
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getByText(text)).toBeDefined();
  });
});
