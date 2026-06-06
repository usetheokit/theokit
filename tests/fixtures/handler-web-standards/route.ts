// Fixture route — Web-standards-shaped handler.
//
// Used by tests/integration/handler-web-standards.test.ts to assert
// that TheoKit handlers can be invoked with a native `Request` and
// return a native `Response` (Phase 5a / R3a per ADR-0028).
//
// Today: `defineRoute` produces a route module that the framework's
// executeRoute consumes through Node's IncomingMessage/ServerResponse.
// The future executeWebRequest entry-point (Phase 5a) will accept
// a Web Request and return a Web Response — turning the T1.2 RED tests
// GREEN.
//
// Acceptance for GREEN (per plan T1.2 + EC-5 honest framing):
//   1. vitest test passes locally (this file)
//   2. `wrangler dev tests/fixtures/handler-web-standards/` returns
//      200 with native Response shape (real Cloudflare Workers smoke).
//
// Vitest alone is NOT sufficient because vitest Node has `node:*`
// available — RED state under vitest is artificial. Wrangler dev is
// the real proof.

import { z } from 'zod'

import { defineRoute } from '../../../packages/theo/src/server/define/define-route.js'

export const GET = defineRoute({
  // No input — pure GET that returns a JSON body.
  query: z.object({}).optional(),
  handler() {
    return { ok: true, message: 'hello from web-standards handler' }
  },
})

export const POST = defineRoute({
  body: z.object({
    name: z.string().min(1),
  }),
  handler({ body }) {
    return { greeting: `hello, ${body.name}` }
  },
})
