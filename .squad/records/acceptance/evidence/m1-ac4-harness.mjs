/**
 * AC4 — "CSRF protection on the Web handler is on by default: a cross-origin POST with no token
 * is rejected by a build that sets no CSRF option."
 *
 * Against the PUBLISHED theokit@0.70.0 in a throwaway project, with the route authored the way
 * the published README authors one — `cycle-acceptance.md § Target kinds` says a library is
 * consumed "following the README verbatim", and three wrong guesses at the API produced three
 * rejections for the wrong reason, each of which reads exactly like the right answer.
 *
 * No csrf option is passed anywhere. The criterion is about the DEFAULT.
 */
import { z } from 'zod'
import { route } from 'theokit/server/define'
import { executeWebRequest } from 'theokit/server/http'

const routeModule = {
  GET: route()
    .policy('public')
    .handler(() => ({ ok: true }))
    .build(),
  POST: route()
    .policy('public')
    .body(z.object({ name: z.string().min(1) }))
    .handler(({ body }) => ({ hi: body.name }))
    .build(),
}

const out = []
async function probe(label, req, expectRejected, why) {
  let res, err
  try {
    res = await executeWebRequest(req, routeModule)
  } catch (e) {
    err = e
  }
  const status = res ? res.status : `threw ${err?.constructor?.name}`
  const body = res ? (await res.text()).slice(0, 110) : String(err?.message).slice(0, 110)
  const rejected = res ? res.status >= 400 : true
  const ok = rejected === expectRejected
  out.push({ label, status, body, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  (${why})\n      -> ${status} | ${body}`)
}

await probe(
  'cross-origin POST, no token',
  new Request('https://app.example.com/x', {
    method: 'POST',
    headers: { origin: 'https://evil.example.com', 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'mallory' }),
  }),
  true,
  'the criterion itself',
)

await probe(
  'same-origin POST with the token header',
  new Request('https://app.example.com/x', {
    method: 'POST',
    headers: {
      origin: 'https://app.example.com',
      'content-type': 'application/json',
      'X-Theo-Action': '1',
    },
    body: JSON.stringify({ name: 'alice' }),
  }),
  false,
  'must SURVIVE — "reject everything" would pass the case above and break the product',
)

await probe(
  'GET, cross-origin',
  new Request('https://app.example.com/x', {
    method: 'GET',
    headers: { origin: 'https://evil.example.com' },
  }),
  false,
  'not state-changing; refusing it would be over-blocking',
)

const failed = out.filter((r) => !r.ok)
console.log(`\nAC4: ${out.length - failed.length}/${out.length} behaved as the criterion requires`)
process.exit(failed.length ? 1 : 0)
