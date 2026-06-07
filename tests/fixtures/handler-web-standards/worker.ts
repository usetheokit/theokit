/**
 * CF Workers entry — Web-standards-shaped handler smoke (Phase 5a / R3a).
 *
 * Per ADR-0028 R3a: TheoKit's server/ surface is pure Web Standards
 * (Request / Response / Headers / Web Crypto). The Phase 5a invariant
 * guard (`tests/unit/r3a-web-crypto-migration-leaf.test.ts`) proves
 * source-level `node:*` count = 0 outside the Category B allowlist
 * (which contains adapter shims that CF Workers never loads).
 *
 * This worker is the executable proof of that invariant: the same
 * `executeWebRequest` that runs under Node bundles cleanly for CF
 * Workers via wrangler/esbuild and serves real HTTP via Miniflare.
 *
 * Run locally (no Cloudflare account required — Miniflare is the
 * default backend in wrangler v3+):
 *
 *   wrangler dev tests/fixtures/handler-web-standards/worker.ts \
 *     --config tests/fixtures/handler-web-standards/wrangler.toml
 *
 * Then:
 *
 *   curl http://localhost:8787/        # → 200 { "ok": true, ... }
 *   curl -X POST http://localhost:8787/ \
 *     -H 'content-type: application/json' \
 *     -d '{"name":"world"}'             # → 200 { "greeting": "hello, world" }
 *
 * Acceptance Criterion T5a.1 #3 (CF Workers smoke test passa real
 * wrangler dev) is satisfied by THIS worker bundling and responding 200
 * under wrangler dev's Miniflare local backend.
 */
import { executeWebRequest } from '../../../packages/theo/src/server/web-handler.js'

import { GET, POST } from './route.js'

const routeModule = { GET, POST }

export default {
  async fetch(request: Request): Promise<Response> {
    return executeWebRequest(request, routeModule, { csrfMode: 'off' })
  },
}
