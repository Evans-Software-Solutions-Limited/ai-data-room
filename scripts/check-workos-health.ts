#!/usr/bin/env bun
// Hits /_health/workos against a deployed stage and exits non-zero on
// failure. Use after `bun sst secret set ...` to verify the new value
// is actually wired through to the Lambda.
//
// Usage:
//   bun run scripts/check-workos-health.ts <api-url>
//   bun run scripts/check-workos-health.ts https://api-core-xxx.execute-api.eu-west-2.amazonaws.com
//
// Exit codes:
//   0 — 200 ok
//   1 — non-200 response (body printed)
//   2 — usage error (no URL supplied)

const apiUrl = process.argv[2];
if (!apiUrl) {
  console.error("Usage: bun run scripts/check-workos-health.ts <api-url>");
  process.exit(2);
}

const target = new URL("/_health/workos", apiUrl).toString();
console.log(`GET ${target}`);

const res = await fetch(target);
const body = await res.text();

console.log(`-> ${res.status}`);
console.log(body);

if (res.status !== 200) {
  process.exit(1);
}
