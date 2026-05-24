import type { BrowserContextOptions } from "@playwright/test";

// Override the browser project's `.auth/session.json` for specs
// that need an anonymous context: `test.use({ storageState:
// emptyStorageState })`. `storageState: undefined` does NOT clear
// the project default in Playwright — you have to pass an empty
// cookie/origin bag explicitly.
export const emptyStorageState: NonNullable<
  BrowserContextOptions["storageState"]
> = { cookies: [], origins: [] };
