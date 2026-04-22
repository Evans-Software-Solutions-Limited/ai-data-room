/// <reference path="./.sst/platform/config.d.ts" />

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
    // anything that talks to it, storage before anything that uploads,
    // api before web (web needs the API URL).
    const secrets = await import("./infra/secrets");
    const storage = await import("./infra/storage");
    const db = await import("./infra/db");
    const api = await import("./infra/api");
    const web = await import("./infra/web");
    return {
      api: api.coreAPI.url,
      web: $dev ? "http://localhost:5173" : web.frontend.url,
      bucket: storage.documentsBucket.name,
      // db / secrets are intentionally not echoed — values are sensitive
      // or computed in-stack. Use `sst secret list` and AWS console.
      _wiring: {
        secrets: Boolean(secrets),
        db: Boolean(db),
      },
    };
  },
});
