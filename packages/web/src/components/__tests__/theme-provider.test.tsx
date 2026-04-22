import { render, screen, act } from "@testing-library/react";
import { vi, beforeEach } from "vitest";
import { ThemeProvider, useTheme } from "../theme-provider";

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
  };
})();

Object.defineProperty(window, "localStorage", { value: localStorageMock });

// Mock matchMedia
Object.defineProperty(window, "matchMedia", {
  value: vi.fn().mockImplementation((query: string) => ({
    matches: query === "(prefers-color-scheme: dark)",
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

function TestConsumer() {
  const { theme, setTheme } = useTheme();
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <button onClick={() => setTheme("dark")}>Set Dark</button>
      <button onClick={() => setTheme("light")}>Set Light</button>
    </div>
  );
}

describe("ThemeProvider", () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
    document.documentElement.classList.remove("light", "dark");
  });

  it("should render children", () => {
    render(
      <ThemeProvider>
        <div>Child content</div>
      </ThemeProvider>,
    );

    expect(screen.getByText("Child content")).toBeDefined();
  });

  it("should default to system theme", () => {
    render(
      <ThemeProvider>
        <TestConsumer />
      </ThemeProvider>,
    );

    expect(screen.getByTestId("theme").textContent).toBe("system");
  });

  it("should respect defaultTheme prop", () => {
    render(
      <ThemeProvider defaultTheme="dark">
        <TestConsumer />
      </ThemeProvider>,
    );

    expect(screen.getByTestId("theme").textContent).toBe("dark");
  });

  it("should allow changing theme", () => {
    render(
      <ThemeProvider>
        <TestConsumer />
      </ThemeProvider>,
    );

    act(() => {
      screen.getByText("Set Dark").click();
    });

    expect(screen.getByTestId("theme").textContent).toBe("dark");
  });

  it("should save theme to localStorage when changed", () => {
    render(
      <ThemeProvider>
        <TestConsumer />
      </ThemeProvider>,
    );

    act(() => {
      screen.getByText("Set Light").click();
    });

    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      "vite-ui-theme",
      "light",
    );
  });
});

describe("useTheme", () => {
  it("should return default state when used outside ThemeProvider", () => {
    // When no provider exists, useContext returns the initialState default
    render(<TestConsumer />);

    // The default theme from initialState is "system"
    expect(screen.getByTestId("theme").textContent).toBe("system");
  });
});
