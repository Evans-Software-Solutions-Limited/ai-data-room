// Ambient declarations for SST Ion globals used inside `infra/**/*.ts`
// + `sst.config.ts`. Purpose: let `bun run typecheck:infra` catch real
// TypeScript mistakes (undefined imports, stale exports, wrong arg
// shapes in OUR code) without dragging in `.sst/platform/src/**` as
// part of the program — SST's internal source has TS errors against
// newer @types/node (e.g. `Buffer<ArrayBufferLike>` vs `BinaryLike`)
// that block a clean compile.
//
// Trade-off: `sst.aws.<Anything>` is typed as `any`, so typos like the
// `sst.aws.KmsKey is not a constructor` regression are NOT caught at
// typecheck time. Those have to be caught at deploy time — see
// `CLAUDE.md` §Workflow (run `bun sst diff --stage <your-dev>` before
// pushing an infra change).
//
// When SST publishes a cleaner type surface (tracked: a dedicated
// typecheck-friendly entrypoint), replace this shim with a triple-slash
// reference back to `.sst/platform/config.d.ts`.

declare namespace sst {
  // Component namespaces — permissive. Real names come from SST runtime.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const aws: Record<string, new (name: string, args?: any, opts?: any) => any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cloudflare: Record<
    string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    new (name: string, args?: any, opts?: any) => any
  >;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const vercel: Record<
    string,
    new (name: string, args?: any, opts?: any) => any
  >;

  // Primitives.
  class Secret {
    constructor(name: string, value?: string);
    readonly name: string;
    readonly value: string;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  class Linkable<T = any> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(name: string, args: { properties: T; include?: any[] });
    readonly name: string;
  }
}

// Pulumi AWS provider — used directly (e.g. `aws.kms.Key`) when an SST
// component isn't yet wrapped.
// eslint-disable-next-line @typescript-eslint/no-namespace
declare namespace aws {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const kms: Record<string, new (name: string, args?: any, opts?: any) => any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s3: Record<string, new (name: string, args?: any, opts?: any) => any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ec2: Record<string, new (name: string, args?: any, opts?: any) => any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sns: Record<string, new (name: string, args?: any, opts?: any) => any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cloudwatch: Record<
    string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    new (name: string, args?: any, opts?: any) => any
  >;
  function getRegionOutput(): { readonly name: string };
}

// SST app globals — minimal shape; keep in sync with SST Ion docs.
// `_SstAppInput` is what SST passes into the `app()` callback. Stage is
// always populated by SST at invocation time, so it's `string` (not
// optional) — this matches what `sst.config.ts` callers see in practice
// (e.g. `protect: ["production"].includes(input.stage)` typechecks).
interface _SstAppInput {
  stage: string;
  [key: string]: unknown;
}
// `_SstApp` is what the `app()` callback *returns* — users supply name +
// home + optional removal/protect. SST fills in stage and the rest, so
// stage is NOT required on the return value.
interface _SstApp {
  name: string;
  stage?: string;
  removal?: "remove" | "retain";
  protect?: boolean;
  home: "aws" | "cloudflare" | "vercel" | "local";
  providers?: Record<string, unknown>;
}
interface _SstConfig {
  app(input: _SstAppInput): _SstApp | Promise<_SstApp>;
  run(): Promise<Record<string, unknown> | undefined>;
}
declare const $config: (input: _SstConfig) => _SstConfig;
declare const $app: { readonly name: string; readonly stage: string };
declare const $dev: boolean;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const $util: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const $output: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const $resolve: any;
