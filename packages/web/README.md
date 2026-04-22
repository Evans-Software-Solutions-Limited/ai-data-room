# Web Package

React SPA built with Vite, Tailwind CSS, shadcn/ui, and TanStack Query. This package is configured as a Progressive Web App (PWA).

## PWA Configuration

This app includes PWA support via `vite-plugin-pwa`. When you customize this template for your own project, update the following to reflect your app's branding and metadata.

### 1. Manifest & Meta Tags

**In `vite.config.ts`** – Update the `manifest` object inside the `VitePWA` plugin:

| Field              | Current                                   | Description                                                                                     |
| ------------------ | ----------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `name`             | `"Web App"`                               | Full app name shown in install prompts and app switcher                                         |
| `short_name`       | `"Web"`                                   | Short name for home screen and splash screen                                                    |
| `description`      | `"A Progressive Web App built with Vite"` | App description for install prompts                                                             |
| `theme_color`      | `"#ef5e41"`                               | Color of the browser UI (address bar, status bar). Maps to `--brand-primary` in `src/index.css` |
| `background_color` | `"#02040f"`                               | Splash screen background. Maps to `--brand-background-darkest` in `src/index.css`               |
| `display`          | `"standalone"`                            | How the app appears when launched. Options: `standalone`, `fullscreen`, `minimal-ui`, `browser` |
| `orientation`      | `"portrait-primary"`                      | Preferred orientation. Options: `any`, `portrait`, `landscape`, etc.                            |
| `start_url`        | `"/"`                                     | URL loaded when the app is opened from the home screen                                          |
| `scope`            | `"/"`                                     | Navigation scope of the PWA                                                                     |

**In `index.html`** – Update these meta tags to match:

- `meta name="theme-color"` – Same as `theme_color` above
- `meta name="description"` – Same as manifest `description`
- `meta name="apple-mobile-web-app-title"` – Same as `short_name`
- `title` – Page title (also used as fallback in some contexts)

### 2. Brand Colors Reference

Colors are defined in `src/index.css`. Use these when setting PWA theme and background:

| CSS Variable                 | Hex       | Use Case                        |
| ---------------------------- | --------- | ------------------------------- |
| `--brand-primary`            | `#ef5e41` | Theme color, primary actions    |
| `--brand-primary-dark`       | `#002c62` | Dark theme variant              |
| `--brand-background-darkest` | `#02040f` | Splash screen, dark backgrounds |
| `--brand-gradient-start`     | `#892887` | Gradient accent                 |
| `--brand-gradient-mid`       | `#e94258` | Gradient accent                 |
| `--brand-gradient-end`       | `#f27224` | Gradient accent                 |

### 3. Icons

Placeholder icons use the brand gradient. Replace them with your own assets:

| File                           | Purpose                                | Recommended Sizes                                |
| ------------------------------ | -------------------------------------- | ------------------------------------------------ |
| `public/pwa-icon.svg`          | General app icon (any context)         | 192×192, 512×512 (or SVG with `sizes="any"`)     |
| `public/pwa-maskable-icon.svg` | Maskable icon (Android adaptive icons) | Keep important content in center 80% "safe zone" |
| `public/vite.svg`              | Favicon                                | 32×32 or small SVG                               |

**For production:** Consider adding PNG versions (192×192, 512×512) for broader compatibility. Update the `icons` array in `vite.config.ts`:

```ts
icons: [
  { src: "/pwa-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
  { src: "/pwa-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
  { src: "/pwa-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
],
```

### 4. Service Worker

The PWA uses `registerType: "autoUpdate"` – the app updates automatically when a new version is deployed. For manual update prompts, change to `registerType: "prompt"`.

**Note:** The workbox config uses `mode: "development"` to avoid terser/rollup compatibility issues with Vite 7. The service worker remains fully functional; remove this option if you want minified output and your build succeeds.

### 5. Testing the PWA

1. Run `bun run build` then `bun run preview`
2. Open Chrome DevTools → Application → Manifest to verify metadata
3. Use "Install" in the address bar or Application tab to test install flow
