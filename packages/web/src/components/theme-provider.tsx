import { createContext, useContext, useEffect, useState } from "react";

type Theme = "dark" | "light" | "system";

type ThemeProviderProps = {
  children: React.ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
};

type ThemeProviderState = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
};

// `setTheme` is a no-op in the default state — it's only meaningful once a
// `ThemeProvider` wraps the consumer. The ThemeProvider tests exercise this
// noop via a `<TestConsumer />` rendered without a provider.
const initialState: ThemeProviderState = {
  theme: "system",
  setTheme: () => {
    /* noop until a ThemeProvider supplies the real setter */
  },
};

const ThemeProviderContext = createContext<ThemeProviderState>(initialState);

export function ThemeProvider({
  children,
  defaultTheme = "system",
  storageKey = "vite-ui-theme",
  ...props
}: ThemeProviderProps) {
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem(storageKey) as Theme) || defaultTheme,
  );

  useEffect(() => {
    const root = window.document.documentElement;

    root.classList.remove("light", "dark");

    if (theme === "system") {
      const systemTheme = window.matchMedia("(prefers-color-scheme: dark)")
        .matches
        ? "dark"
        : "light";

      root.classList.add(systemTheme);
      return;
    }

    root.classList.add(theme);
  }, [theme]);

  const value = {
    theme,
    setTheme: (theme: Theme) => {
      localStorage.setItem(storageKey, theme);
      setTheme(theme);
    },
  };

  return (
    <ThemeProviderContext.Provider {...props} value={value}>
      {children}
    </ThemeProviderContext.Provider>
  );
}

// `createContext(initialState)` guarantees `useContext` always returns a
// `ThemeProviderState` (never `undefined`), so there's no defensive throw
// here — using `useTheme` outside a `ThemeProvider` simply returns the
// noop default.
export const useTheme = () => useContext(ThemeProviderContext);
