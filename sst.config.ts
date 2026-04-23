// SST globals (`$config`, `$app`, `$dev`, `sst.*`, `aws.*`) are declared by
// our own ambient shim at `infra/_sst-globals.d.ts`, which TypeScript picks
// up automatically via `tsconfig.infra.json`'s `include`. We intentionally
// do NOT `/// <reference path="./.sst/platform/config.d.ts" />` here —
// that shipped .d.ts transitively imports `.sst/platform/src/components/**`
// whose internal source does not typecheck cleanly against modern
// @types/node. See the shim header for the full trade-off and the
// deploy-time guard (`bun sst diff`) that covers what the shim relaxes.

export default $config({
  app(input) {
    return {
      name: "ai-data-room",
      removal: input?.stage === "production" ? "retain" : "remove",
      protect: ["production"].includes(input?.stage),
      home: "aws",
    };
  },
  async run() {
    // Wire infrastructure modules in a deterministic order:
    // secrets must exist before anything that consumes them, db before
    // anything that talks to it, api before web (web needs the API URL).
    //
    // `infra/storage.ts` is a stub until slice 2 (`room-and-folders`) —
    // see that file's header for the declare-when-shipped rationale.
    const secrets = await import("./infra/secrets");
    const db = await import("./infra/db");
    const api = await import("./infra/api");
    const web = await import("./infra/web");
    return {
      api: api.coreAPI.url,
      web: $dev ? "http://localhost:5173" : web.frontend.url,
      // secrets + db intentionally not echoed — values are sensitive or
      // computed in-stack. Use `sst secret list` and AWS console.
      // The `bucket` output lands in slice 2 when storage is declared.
      _wiring: {
        secrets: Boolean(secrets),
        db: Boolean(db),
      },
    };
  },
});
