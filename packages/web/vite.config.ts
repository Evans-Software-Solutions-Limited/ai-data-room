import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["vite.svg", "pwa-icon.svg", "pwa-maskable-icon.svg"],
      manifest: {
        name: "Web App",
        short_name: "Web",
        description: "A Progressive Web App built with Vite",
        theme_color: "#ef5e41",
        background_color: "#02040f",
        display: "standalone",
        orientation: "portrait-primary",
        start_url: "/",
        scope: "/",
        icons: [
          {
            src: "/pwa-icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any",
          },
          {
            src: "/pwa-maskable-icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        cleanupOutdatedCaches: true,
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        // Disable minification to avoid terser/rollup compatibility issues with Vite 7
        mode: "development",
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    chunkSizeWarningLimit: 800,
  },
  test: {
    globals: true,
    environment: "jsdom",
    coverage: {
      provider: "v8",
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 90,
        statements: 90,
      },
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "node_modules",
        "**/*.test.{ts,tsx}",
        "**/*.config.{ts,js}",
        "**/components/ui/**",
        "src/main.tsx",
        "src/vite-env.d.ts",
      ],
    },
  },
});
