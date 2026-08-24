/**
 * The door a GENERATED deploy entry uses to serve an agent (usetheokit/theokit#367).
 *
 * ## Why the file lives here and ships as `theokit/adapters/agent-mount`
 *
 * The published name follows its CONSUMER — it sits beside `theokit/adapters/web-shim` and
 * `theokit/adapters/security-headers`, the other doors generated entries already use. The file
 * lives under `server/` because the module graph says so: `adapters/` may not depend on `server/`
 * (`adapters-may-only-depend-on-core-router-services`), and putting a re-export of three `server/`
 * modules in that directory is that edge no matter what the re-export is for. The rule is about
 * the graph, not about intent, and it was right to refuse.
 *
 * ## Why this exists rather than an export from `theokit/server`
 *
 * `mount-agent` is deliberately NOT part of the public server surface — `server/index.ts` says so
 * out loud, and ADR 0041 decided it: *"`mount-agent` and `configure-agent-registry` remain
 * internal."* That decision is about what an APPLICATION may import, and it is a good one.
 *
 * A generated entry is not an application. It is this framework's own code, written by this
 * framework's own build, and it needs exactly the same two functions `theokit start` uses to serve
 * an agent — `mountAgent` and `resolveProvider`. It already reaches `createWebShim`,
 * `buildSecurityHeaders` and the WS bridges through the same door, which is why the door exists.
 *
 * So this is a named, intentional subpath for emitted code, not a widening of the app-facing API.
 * The ADR's boundary is unchanged: `theokit/server` still does not export `mountAgent`, and an
 * application importing from here is importing something whose documentation says it is for
 * generated entries.
 *
 * ## What it does NOT solve
 *
 * Only targets whose output is bundled from the project can use it, because serving an agent means
 * importing the agent's own module, and the module is app source. That is `cloudflare`, `bun` and
 * `deno-deploy` — the same three that can carry plugins, for the same reason. `vercel`, `netlify`
 * and `aws-lambda` receive a standalone function directory that never sees the app's modules.
 */
export { mountAgent } from './agent/mount-agent.js'
export { resolveProvider } from './agent/provider-resolver.js'
// Only the targets WITH a filesystem use this: Bun and Deno scan their agents at request time, the
// same way they already scan their routes. A Worker has neither the filesystem nor the need — its
// agents are static imports decided on the build machine.
export { scanAgents } from './scan/agent-scan.js'
