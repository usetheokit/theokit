# J7 — Rate limit

The seventh of the ten benchmark journeys (`../dx-benchmark.md`). Criteria written before either
implementation exists; a journey whose criteria change after code exists is void and must be re-run
from scratch.

**Scheduling status:** ready. `../dx-benchmark.md` § Sequencing lists J7 in the first batch to be
implemented and measured.

## What the journey requires

Copied from `../dx-benchmark.md` § The ten journeys, unchanged. Rewording it requires an ADR,
because a movable target measures nothing.

| # | Journey | What must work |
| --- | --- | --- |
| J7 | **Rate limit** | A caller exceeding a declared budget is refused, and told so |

Three obligations. **Declared** — the budget is configuration, not a constant compiled into a
handler. **Refused** — the work does not happen, not merely a warning. **Told so** — the caller can
distinguish this refusal from every other failure and knows when to come back.

## Acceptance criteria

In the shape `ROADMAP.md` uses: observable, with an oracle, graded by `/acceptance` against the
released artifact rather than the working tree (`.claude/rules/cycle-acceptance.md` § Target kinds).

**Definition of done (all must hold):**

- [ ] with a budget of N declared in configuration, request N succeeds and request N+1 is refused,
      against a published build — asserted on the boundary rather than on a large burst, so an
      off-by-one is caught rather than averaged away
- [ ] the refusal is machine-readable and distinguishable: the response carries the rate-limit
      status code and an error code that is not shared with any other failure class, read from the
      parsed body rather than from the status alone
- [ ] the refusal tells the caller when to retry: a retry-after value is present and, after waiting
      it out, the next request succeeds — the wait is performed and the follow-up asserted, so the
      header is verified rather than merely observed
- [ ] the refused request did no work: the handler's side effect is absent for the refused request,
      counted inside the handler, so "counted then executed" is distinguishable from "refused"
- [ ] the budget applies to the agent path and not only to plain routes: a caller exceeding the
      budget on `POST` to an agent endpoint is refused with the same code and the same headers as on
      a plain route — this criterion exists because § Current state records that it does not hold in
      every mode today
- [ ] Applies to: Web, Tauri, TUI — each listed target is exercised in acceptance, not merely
      declared
- [ ] Tauri: a declared budget is enforced on the in-process path, or the framework refuses the
      configuration by name. Silent non-enforcement off-HTTP is the failure
      `../three-target-parity.md` names
- [ ] TUI: same seam, same rule — enforced, or refused by name, never silently absent

**What resisted an oracle.** "Fair across callers" — the property that actually makes a limiter
useful — is not gradeable in a single run. Two callers, one budget, is testable; *fairness under
contention* needs a load profile and a statistical claim, which would turn this journey into a
performance benchmark. It is excluded, and the exclusion is stated rather than smuggled in behind a
criterion that looks like it covers it.

## The Next.js side

**There is no framework primitive, and the honest equivalent is a well-known library plus a store.**
Next.js ships no rate limiter. The idiomatic answer, and the one Vercel's own templates use, is a
sliding-window limiter backed by a serverless Redis, applied in middleware or at the top of a Route
Handler.

The reference implementation: the limiter library configured with a window and a limit, a store
instance, and the check at the entry point returning the rate-limit status with the retry-after
header. Where an official example exists it must be used and cited
(`../dx-benchmark.md` § Why the protocol comes before the measurement).

*To confirm at implementation time, because these are version-specific and this document is written
without access to that source:* the current package names for the limiter and its store, whether the
limiter's default algorithm is sliding-window or fixed-window, and whether the current
recommendation places the check in middleware or in the handler.

**Two asymmetries must be recorded before any number exists, and one of them cuts against us.**
First, the platform-level firewall that the Next.js host offers is *not* the comparison: it is
configuration in a dashboard, not code, and this benchmark measures code. Second, the library's
store is distributed and, as measured below, ours is not — so a like-for-like comparison must either
run both single-instance or state plainly that the two limiters have different operational reach.
The second option is the honest one and the report must take it.

## How the four metrics are counted here

The general counting rule is in `../dx-benchmark.md` § The four metrics. What follows is that rule
landed on this journey.

**Files touched.** Counted: the configuration that declares the budget, any middleware or handler
edit, the store setup, and any file the developer touches to extend the budget to the agent path.
Not counted: the route being protected, if it already existed — but any edit made to it is counted.

**Glue lines.** The budget numbers are business logic — a window and a limit are a real product
decision. Everything else is glue: the store construction, the key derivation, the check, the header
writing, the error mapping. Provisioning a store counts as glue on the side that needs one, and its
absence counts as zero on the side that does not, with the operational difference recorded rather
than scored.

**Concepts required.** Derived mechanically from the imports and APIs the diff uses. Expected on
ours: the config key, the per-route shape, the key-derivation strategy, and the trust-proxy setting
if the run goes through one. Expected on the Next.js side: the limiter constructor, the algorithm
choice, the store client, and its credentials. Credentials count as a concept: a developer who must
create an account to satisfy a journey has learned a name they did not know.

**Time to first green run.** Wall clock from `npx create-theokit` to the first run where all five
assertions pass, including criterion 3's real wait. The wait is a fixed, declared cost on both sides
and is subtracted from the reported figure — this is the only subtraction any journey makes, and it
is made because the value is chosen by the test rather than by the framework.

## Measured - TheoKit side, metrics 1-3 (2026-08-20)

**Three of four metrics, one side.** This is not the journey being won; it is the first number this
journey has. Metric 4 and the whole Next.js side are unmeasured, and the subsection below says why.

Obtained from a real diff, not an estimate: the scaffold template was copied verbatim, committed as
an untouched baseline, and the journey implemented on top. The counts are `git diff --numstat` over
that commit.

| Metric | TheoKit | How it was counted |
| --- | --- | --- |
| Files touched | **1** | `theo.config.ts` edited. Nothing else is created or edited: the limiter is already applied on every `/api` branch of the production server (`packages/theo/src/cli/commands/start/handlers.ts:92`, applied at `:115`, `:224`, `:277`, `:406`) |
| Glue lines | **2** | of 3 added lines and 1 removed; the third added line is business logic, because it is the budget |
| Concepts required | **3** | the `rateLimit` config key, its flat `{ windowMs, max }` shape, and `config().set()` - the builder ships no `.rateLimit()` setter, so the escape hatch is the only door (`packages/theo/src/config/config-builder.ts:38`) |
| Time to first green run | **not measured** | see below - and the reason is not credits |

**The 3 added lines, classified.** Published because the glue split is the metric most open to being
argued after the fact, and a table nobody can check is not evidence - least of all one published by
the side it favours.

Glue (2): `export default config()` and `  .build()` - the two lines the formatter breaks the chain
into, which the removed line already contained.

Business logic (1): `  .set({ rateLimit: { windowMs: 60_000, max: 20 } })`. The window and the limit
are a product decision, and the rule above says so.

**Four judgement calls, stated rather than buried.**

1. **The whole `.set(...)` line was counted as business logic**, although it also carries the
   declaration wrapper. Splitting a line between the two categories is not something the rule
   defines, and counting the line as glue would report a journey whose entire authored content is a
   product decision as containing none. Deciding the other way gives 3 glue and 0 business logic.
2. **`numstat` was reported as it counts, not as the edit reads.** Three lines are added and one
   removed; the substance is a single inserted line, because the formatter breaks a three-call chain
   across lines. Counting substance gives 1 added line. This is the same divergence J3 recorded, and
   it is reported the same way.
3. **The flat shape was chosen over the per-route shape.** Both satisfy the criteria on a published
   build - `createRouteRateLimiter` normalises the flat form into the default bucket
   (`packages/theo/src/server/rate-limit/rate-limit-per-route.ts:151`) - and the flat one is one
   line. The per-route shape is a nested object instead of a flat one; it was not measured, because
   the criteria do not need per-route budgets, and it is the shape § The deliberately broken state
   records the dev server narrowing away before it reaches the limiter
   (`packages/theo/src/cli/commands/dev.ts:63`).
4. **No store was provisioned, and that is a zero rather than an omission.** The rule says a store
   counts as glue on the side that needs one and as zero on the side that does not, with the
   operational difference recorded rather than scored. Ours cannot have one: every shipped factory
   refuses anything but the in-memory implementation
   (`packages/theo/src/server/rate-limit/rate-limit.ts:53`,
   `packages/theo/src/server/rate-limit/rate-limit-per-route.ts:162`). So the zero here is the same
   fact as the reach asymmetry § The Next.js side already said the report must state plainly.

**Which target the run measures decides the result, and that is not a detail.** Criteria 1 and 5
hold on the Node production server and fail on the Web-standards handler, whose rate-limit factories
have no production caller (`packages/theo/src/server/rate-limit/rate-limit.ts:105`,
`packages/theo/src/server/rate-limit/rate-limit-per-route.ts:295`). Six deploy targets are built on
that handler. A one-line diff that protects `theokit start` and protects nothing on those targets is
one number with two meanings, and `j10-deploy.md` measures the other one.

### What is still unmeasured, and why

**Metric 4 (time to first green run) was not measured, and the reason is different here.** This
journey needs no live model call: the refusal happens before the agent runs, so even criterion 5 is
gradeable without a model key. What blocks it is the rest of the protocol - at least three cold runs
from `npx create-theokit`, including criterion 3's real wait, and a second side to compare against.
Recording that difference matters: J7 is the cheapest of the ten to time, and it is still not timed.

**Nothing was executed.** No build, no server, no request, no refusal observed. Criteria 1 through 5
are read from source: the limiter is constructed when the key is present
(`packages/theo/src/cli/commands/start/index.ts:123`), applied before the handler on each `/api`
branch, and answers with a dedicated code and a retry-after header
(`packages/theo/src/server/rate-limit/rate-limit-per-route.ts:210`). Read is not run.

**The Next.js side does not exist yet.** Until it does, nothing here is a comparison, and the winning
rule cannot be applied. A journey is won or tied; a one-sided count is neither.

**Behaviour under concurrency and at the fixed window's seam is out of scope by the exclusion this
page already stated**, and this measurement neither narrows nor widens it.

**The three-target criteria cannot be exercised in this repository.** The Tauri and TUI lines need
`@theokit/tui` and `@theokit/ui`, which live outside it (`.claude/rules/three-target-parity.md`
records the same limit). What settles them is the north-star app
(`.claude/rules/northstar-app.md`), which does not exist yet. Criterion 7's real question - whether a
declared budget is enforced off HTTP or refused by name - is untouched by a diff that only declares
one.

**So: J7 is not won, not tied, and not run.** It has one side of three metrics, on the one target
where the mechanism is wired.

## Measured — both sides, exercised (2026-08-20)

**The section above had one side and had run nothing. This one has both sides, and both were run.**
It does not replace the counts above — it reproduces them from an independent diff and adds the
Next.js half, the criteria graded against real requests on real published builds, and two defects
that only a run could find.

Every request below went over HTTP to a published build on each side — `theokit build` +
`theokit start` on ours, `next build` + `next start` on theirs — driven from a separate process,
with the side-effect oracle in a third. Three runs per lane; the three agreed on every row.

### The three version-specific facts, confirmed against the source

§ The Next.js side deferred three questions to implementation time. All three were checked against
the packages actually installed and against Vercel's and Upstash's own documentation, and the
answers are recorded including where they refute what the section supposed.

| Deferred question | Answer | Checked against | Diverged from the supposition? |
| --- | --- | --- | --- |
| The current package names for the limiter and its store | `@upstash/ratelimit@2.0.8` and `@upstash/redis@1.38.2` | the installed packages, and `npm view` | **Partly, and it matters.** The names are right, but they are no longer what *Vercel* documents — see the row below the table |
| Whether the limiter's default algorithm is sliding-window or fixed-window | **Neither: there is no default.** `limiter` is a required field of `RegionRatelimitConfig`, with no `?`. The README's Basic Usage picks `slidingWindow`; the Upstash/Vercel template `ratelimit-with-redis` picks `fixedWindow` | the installed `dist/index.d.ts`, the README, and the template the Vercel gallery links to | **Yes.** The question presupposed a default. The developer must choose, and the two official samples choose differently |
| Whether the current recommendation places the check in middleware or in the handler | **The handler**, in both first-party sources. Vercel's rate-limiting SDK page and the Next.js "Backend for Frontend" guide both show `export async function POST(request: Request)` | vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting-sdk; nextjs.org/docs/app/guides/backend-for-frontend | **Yes, and the middleware file has been renamed underneath the question.** In Next 16 the convention is `proxy.ts` with an exported `proxy`; `middleware.ts` is deprecated but still works, and `proxy` runs on Node only |

**A fourth fact the section did not anticipate, and it decides what the Next.js side even is.**
Vercel's own answer to "rate limit in code" is now `@vercel/firewall@1.2.5` and its
`checkRateLimit()`. It is not a limiter. Reading its `dist/rate-limit.js`: it issues an HTTP request
to `https://${host}/.well-known/vercel/rate-limit-api/${id}` and decides from the status alone
(`204` allow, `429` refuse, `403` blocked, `404` → `console.warn` and **allow**). The id must match a
rule created in the Vercel dashboard, and outside `NODE_ENV=production` the function returns
`{ rateLimited: false }` after a warning. So it cannot be exercised off-platform, it fails **open**
when unconfigured, and it is a client for a dashboard rule — precisely the thing § The Next.js side
already ruled out of this comparison, now wearing an import statement. It is recorded and not
measured, and the reason is the one this page wrote before it existed.

That leaves `@upstash/ratelimit` as the benchmarkable answer, which is also what the Vercel template
gallery points at — `vercel.com/templates/next.js/api-rate-limit-upstash` now links out to
`upstash/examples/tree/main/examples/ratelimit-with-redis`.

**Two official examples were read and neither could be used verbatim, which is itself the finding.**
`vercel/examples`' `edge-middleware/rate-limit-any-framework` pins `@upstash/ratelimit@^0.4.3`
(current: 2.0.8) on `@vercel/kv`, a package npm now marks deprecated. The Upstash template pins
`next@14.2.15` and calls `headers()` without `await`, which Next 16 removed. The implementation below
follows their shape — construct, `limit(key)`, branch on `success` — on current versions.

Versions under test: **TheoKit** — `create-theokit@latest` → `theokit@0.48.14`,
`@theokit/agents@10.1.0`, `@theokit/sdk@4.53.1`, `@theokit/ui@1.4.1`, `zod@4.4.3`, React 19.2.8.
**Next.js** — `next@16.3.1`, `ai@7.0.70`, `@ai-sdk/react@4.0.73`, `@upstash/ratelimit@2.0.8`,
`@upstash/redis@1.38.2`, `zod@4.4.3`, React 19.2.8. Node 22.22.2 on both. Source claims are read from
the worktree at `6e4102775`.

### The instrument, and why this journey could be run without credits

Counted on neither side.

**The store.** The Next.js lane runs against a real Redis: `redis:7-alpine` behind
`hiett/serverless-redis-http`, the Upstash-compatible HTTP proxy Upstash's own "Developing with
Upstash Redis" page names for local development. `@upstash/redis` speaks REST, so this is the real
client against a real server — not a stub. The TheoKit lane provisions nothing, because it cannot:
every shipped factory refuses anything but the in-memory store.

**The side-effect oracle.** An append-only recorder on `:4311`, byte-identical for both sides. Each
lane has one probe route whose handler POSTs to it before returning. Criterion 4 is graded by reading
that log back from outside both frameworks, so "did the handler run" is an artefact rather than a
claim about a response body.

**The model.** The Next.js lane uses the AI SDK's `MockLanguageModelV4` driven by
`simulateReadableStream`, scripted to emit one text delta and finish. J6's trap is avoided
(`finishReason` is `{ unified, raw }`) and J2's correction applied (`LanguageModelV4Usage` nests its
counts) — with one further correction of the same kind, recorded because the next journey will hit
it: in `ai@7.0.70` the nesting is **asymmetric**, `inputTokens` taking
`{ total, noCache, cacheRead, cacheWrite }` and `outputTokens` taking `{ total, text, reasoning }`.
`convertToModelMessages` also returns a promise now and must be awaited.

**The TheoKit lane has no model, and that is a finding rather than a shortcut.** J6 and J2 reached a
local model through `@theokit/sdk`'s `ollama` / `lmstudio` catalog profiles (`authType: "none"`), but
they did it in a harness. This journey must grade a **published build**, because that is where the
limiter is wired, and `theokit start` resolves providers through a registry that knows only
`openrouter`, `openai` and `anthropic` (`packages/theo/src/server/agent/provider-resolver.ts:90`). The
documented escape hatch, `registerProvider`, does not work: the published bundle ships the registry
**twice**, and the copy the application mutates is not the copy the server reads
([#401](https://github.com/usetheokit/theokit/issues/401)). So on the agent path the three unrefused
requests answer `500 INTERNAL — No LLM provider API key found`. That is still a usable oracle for
criterion 5, and a sharper one than a 200 would be: a 500 from the provider resolver proves the agent
branch **ran**, and the 429 proves the refused one did not.

### The baselines, and the argument for each

| Lane | Baseline | Argument |
| --- | --- | --- |
| TheoKit | `npx create-theokit@latest tk-rate --yes`, committed untouched by the scaffolder itself | Unchanged from J4: the app has to run, and this is what a developer installs today |
| Next.js | `create-next-app` (TypeScript, App Router, Tailwind, Turbopack) + `npm install ai @ai-sdk/react zod` + the AI SDK quickstart's chat Route Handler at `app/api/chat/route.ts`, committed untouched | J1's argument, unchanged and load-bearing here: the TheoKit scaffold hands the developer a working agent endpoint for free, and criterion 5 requires one on both sides. Charging Next.js for building an agent while TheoKit is charged for none would measure the two scaffolds |

Each lane also carries one instrument route (`server/routes/probe.ts`, `app/api/probe/route.ts`) and
one instrument model swap, both in the baseline commit and counted on neither side.

**One formatting control**, unchanged from J1: both diffs are formatted with the `create-theokit`
Prettier config (`packages/create-theokit/templates/default/.prettierrc`, `printWidth: 100`,
`semi: false`), so both sides are counted with the same ruler.

### Metrics 1-3

| Metric | TheoKit | Next.js + `@upstash/ratelimit` | Margin | Bar |
| --- | --- | --- | --- | --- |
| Files touched | **1** | **3** | 3x | ≥ 2x — **outside** |
| Glue lines | **2** | **26** | 13x | ≥ 2x — **outside** |
| Concepts required | **3** | **9** | 3x | ≥ 2x — **outside** |
| Time to first green run | not measured | not measured | — | — |

**TheoKit, 1 file.** `theo.config.ts`, 3 added lines and 1 removed. Independently re-derived here
from a fresh scaffold and identical to the section above, which is the point of publishing it twice.

```
+export default config()
+  .set({ rateLimit: { windowMs: 5_000, max: 3 } })
+  .build()
-export default config().build()
```

Glue (2): `export default config()` and `  .build()`. Business logic (1): the `.set(...)` line, which
carries the window and the limit. The values differ from the section above (5 s / 3 rather than 60 s /
20) because criterion 3 performs the wait; the line count is identical either way and the budget is a
product decision, so the substitution changes nothing it is not allowed to change.

**Next.js, 3 files.** `proxy.ts` added (26 lines, 3 blank), `package.json` (2 dependency lines),
`.env.local` added (2 lines). `package-lock.json` is not counted: it is tool output nobody edits by
hand, the same exclusion the metric applies to scaffolder output on both sides.

```ts
import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.fixedWindow(3, '5 s'),
})

export const config = { matcher: '/api/:path*' }

export async function proxy(request: Request) {
  const key = request.headers.get('x-forwarded-for') ?? 'anonymous'
  const { success, limit, remaining, reset } = await ratelimit.limit(key)
  if (success) return
  return Response.json(
    { error: { code: 'RATE_LIMITED', message: 'Too many requests' } },
    {
      status: 429,
      headers: {
        'Retry-After': String(Math.ceil((reset - Date.now()) / 1000)),
        'X-RateLimit-Limit': String(limit),
        'X-RateLimit-Remaining': String(remaining),
      },
    },
  )
}
```

plus, in `package.json`, `"@upstash/ratelimit": "^2.0.8"` and `"@upstash/redis": "^1.38.2"`; and in
`.env.local`, `UPSTASH_REDIS_REST_URL=…` and `UPSTASH_REDIS_REST_TOKEN=…` (values redacted here; the
run used the local proxy and a token invented for it).

**The 27 non-blank added lines, classified.** Published because the glue split is the metric most
open to being argued after the fact, and a table nobody can check is not evidence — least of all one
published by the side it favours.

Business logic (1): `  limiter: Ratelimit.fixedWindow(3, '5 s'),` — the window and the limit, by the
same whole-line rule the TheoKit side used.

Glue (26): the two imports; `const ratelimit = new Ratelimit({`, `  redis: Redis.fromEnv(),`, `})`;
the `config` matcher export; the function signature; the key derivation; the `limit()` destructuring;
the `if (success) return`; the eleven lines of `Response.json` with its body and its three headers;
the closing `)` and `}`; the two dependency lines; the two environment lines.

**Concepts, derived mechanically from what the diffs import and call.**

| TheoKit (3) | Next.js (9) |
| --- | --- |
| the `rateLimit` config key | the `Ratelimit` constructor |
| its flat `{ windowMs, max }` shape | `Ratelimit.fixedWindow` — and that an algorithm must be chosen, because there is no default |
| `config().set()`, because the builder ships no `.rateLimit()` setter (`packages/theo/src/config/config-builder.ts:38`) | `Redis.fromEnv()`, the store client |
| | the `UPSTASH_REDIS_REST_URL` / `_TOKEN` contract — credentials, which this page's counting rule says count |
| | the `proxy.ts` convention and its exported `proxy`, Next 16's renamed middleware |
| | `config.matcher` |
| | the `limit()` result shape, including that `reset` is an absolute epoch **milliseconds** value |
| | `x-forwarded-for` as the bucket key |
| | `Retry-After`, which the developer writes by hand because the library ships no header helper |

`Response.json` is not counted: it is Web-standard vocabulary the baseline already uses. Counting it
gives 10 and does not change the shape of the result.

### The criteria, graded against the runs

Three runs per lane, same machine, budget `max: 3` over a 5 s window on both sides. Every row is
measured, not read.

| # | Criterion | TheoKit | Next.js + `@upstash/ratelimit` |
| --- | --- | --- | --- |
| 1 | request N succeeds, N+1 refused, asserted on the boundary | **PASS** — `200, 200, 200, 429` on all three runs | **PASS** — `200, 200, 200, 429` on all three runs |
| 2 | machine-readable, a dedicated code read from the parsed body | **PASS** — `{"error":{"code":"RATE_LIMITED","message":"Too many requests","requestId":"…"}}` at 429. The code is exclusive: the *token* budget crosses as `TOO_MANY_REQUESTS` (`packages/theo/src/core/contracts/server-error-to-envelope.ts:48`), a different code on the same status | **PASS** — `{"error":{"code":"RATE_LIMITED","message":"Too many requests"}}` at 429. Exclusive by construction, because the application authored both the code and the envelope |
| 3 | a retry-after value is present, the wait is performed, the follow-up succeeds | **PASS** — `Retry-After: 5`; a request at deadline−1.2 s is still `429`; after the full wait, `200`. Identical on all three runs | **PASS** — `Retry-After: 2, 4, 2` across runs (it varies with position in the fixed window, which is correct); deadline−1.2 s still `429`; after the full wait, `200` |
| 4 | the refused request did no work, counted inside the handler | **PASS** — recorder holds exactly **3** entries after the four requests, and **4** after the post-wait request | **PASS** — recorder holds exactly **3**, then **4** |
| 5 | the same refusal on the agent path as on a plain route | **PASS** — `POST /api/agents/chat` gives `500, 500, 500, 429`; the 429 carries the same `RATE_LIMITED` body and a **byte-identical** header set to the plain route's. The three 500s are the provider resolver, i.e. proof the agent branch ran; the 429 arrives in 4-9 ms without it | **PASS** — `200, 200, 200, 429`, the three 200s streaming a real run (`text-delta … "MODEL-OK"`), the 429 carrying the same code and the same three headers as the plain route |
| 6-8 | Web, Tauri, TUI exercised | **not exercisable here**, unchanged from the section above: `@theokit/tui` and `@theokit/ui` live outside this repository and the north-star app does not exist | **n/a** — the journey's three-target rule is transversal to TheoKit |

**Five of five against five of five, both sides exercised.** That is the second time in this
programme, after J4, that both sides built the thing the criteria describe.

### Who the limit is applied to — measured, not assumed

The criteria do not ask this and the answer changes what the numbers mean, so it was run as its own
block: exhaust the budget with no forwarded header, then repeat carrying one.

| Request after the budget is exhausted | TheoKit | Next.js |
| --- | --- | --- |
| no extra header (control) | 429 | 429 |
| `x-forwarded-for: 203.0.113.7` | **429** | **200** |
| `x-forwarded-for: 203.0.113.8` | **429** | **200** |
| `x-real-ip: 203.0.113.9` | 429 | 429 |

**There is a concept of identity at this point on both sides, and only one of them is not
client-writable by default.** TheoKit keys on `req.socket.remoteAddress` and ignores
`x-forwarded-for` unless the operator declares how many proxies to trust
(`packages/theo/src/server/rate-limit/client-ip.ts:53`), and offers `keyBy: 'session' | 'user' | fn`
above that (`packages/theo/src/config/schemas/rate-limit.ts:16`). The Next.js idiom has no equivalent:
`request.ip` no longer exists, the official samples read `x-forwarded-for` with an `'anonymous'`
fallback, and a header any client can set is therefore the bucket key. Two spoofed values, two
bypasses, measured.

**This is stated as an asymmetry and not scored, and the fairness note is the whole of it.** On
Vercel the platform writes `x-forwarded-for` and the header is not client-controlled, so on-platform
the idiom is sound. Off-platform — which is where this measurement ran, and where a self-hosted
Next.js application lives — it is a one-header bypass. The shorter Next.js implementation is the one
the criteria reward; the safer one costs a trust-hop concept and more lines. Neither side is charged
for the difference.

The other half of the same question, and it goes the other way: **TheoKit's limit is per-caller and
per-process.** Every shipped factory throws when handed anything but the in-memory store
(`packages/theo/src/server/rate-limit/rate-limit.ts:53`,
`packages/theo/src/server/rate-limit/rate-limit-per-route.ts:162`), so three instances mean three
budgets. The Next.js one was exercised against a real Redis and has one budget however many instances
there are. § The Next.js side said this must be stated plainly rather than scored, and this is it.

### Is the refusal legible, and does it match the specification

Both sides refuse with `429` and a parsed-body code, and both tell the caller when to return. Neither
speaks the current specification.

| | TheoKit | Next.js (as written here) |
| --- | --- | --- |
| Status | 429 (RFC 6585) | 429 |
| Body code | `RATE_LIMITED` | `RATE_LIMITED` |
| `Retry-After` | present, `5` — RFC 9110 § 10.2.3 `delay-seconds` | present, computed by the application from `reset − Date.now()` |
| `RateLimit` / `RateLimit-Policy` (draft-ietf-httpapi-ratelimit-headers-11) | **absent** | **absent** |
| `X-RateLimit-*` | `Limit`, `Remaining` — the legacy names the draft's appendix catalogues as an interop problem; no `Reset` | same three, written by hand |
| Headers on a **successful** response | `X-RateLimit-Limit`, `X-RateLimit-Remaining` on every response | **none** — the proxy returns `undefined` to continue, and adding headers there costs another concept |

**No sixth instance of the B-021 family here, and that is worth saying plainly.** A refused request
on both sides is reported as refused, with a status, a code and a deadline. This journey looked for
the failure `docs/adr/0002-an-abnormal-ending-is-never-reported-as-normal.md` names and did not find
it in the refusal path.

**One prediction this measurement made and then refuted.** Upstash's `reset` is documented as the end
of the current window, and under `slidingWindow` the previous window's weighted contribution should
still exceed the limit at that instant — so obeying `Retry-After` ought to fail criterion 3. It was
run: the limiter was rebuilt with `Ratelimit.slidingWindow(3, '5 s')` and the burst-then-obey cycle
repeated three times. All three succeeded (`Retry-After` 2, 3, 4 s; `200` after each). The prediction
was wrong and the entry is the measurement, not the reasoning.

### Two defects the run found, both filed

Neither is a rate-limit defect, and both were found because this journey insisted on a published
build rather than a harness.

- **[#400](https://github.com/usetheokit/theokit/issues/400) — every `POST` with a JSON body to an
  `/api` file route hangs forever under `theokit start`.** Not a 500, not a timeout: the connection
  stays open and the handler never runs. `theokit dev` serves the same request in 4-44 ms.
  `tryServeAgentAux` runs before the API branch for every URL
  (`packages/theo/src/cli/commands/start/request-handler.ts:255`) and converts the request to a Web
  `Request` **before** deciding it does not own the path
  (`packages/theo/src/cli/commands/start/handlers.ts:187`), which drains the Node stream
  (`packages/theo/src/server/http/node-request.ts:68`); `parseJsonBody` then waits on an `'end'` that
  already happened (`packages/theo/src/server/body-parser.ts:63`). Tracing the published bundle
  confirms it: at the moment the parser attaches, `readableEnded: true, complete: true,
  readableLength: 0`, and the listener already on the stream is Node's internal `onData` from
  `Readable.toWeb`. **The probes here send no body for exactly this reason**, which the criteria
  permit and which is recorded rather than smoothed over.
- **[#401](https://github.com/usetheokit/theokit/issues/401) — `registerProvider` mutates a registry
  `theokit start` never reads.** The published bundle carries the provider registry in two chunks with
  independent module state; the application's `theokit/server` import reaches one and the CLI reaches
  the other, and no `./dist/*` export exists to reach the second. This is what kept a local model off
  the TheoKit lane's agent path.

### Declared judgements, with the effect of inverting each

| # | Judgement | Decided | Effect of the other choice |
| --- | --- | --- | --- |
| 1 | Does `package.json` count as a file touched on the Next.js side? | **Counted**, on J3's reasoning: `@upstash/ratelimit` and `@upstash/redis` exist only because this criterion does | Files 3 → 2 (2x, still at the bar); glue 26 → 24 (12x) |
| 2 | Does `.env.local` count as a file touched? | **Counted.** This page's own rule says provisioning a store counts as glue on the side that needs one, and credentials count as a concept; the file is where the store is provisioned | Files 3 → 2; glue 26 → 24. Both still outside the bar, but metric 1's margin lands exactly on 2x, which is a loss for Next.js rather than a tie only because the bar is "≥ 2x" |
| 3 | Is the whole `limiter:` line business logic on the Next.js side, as the whole `.set(…)` line is on ours? | **Yes**, symmetrically. The line carries the budget and also the algorithm name | Glue 26 → 27 on theirs and 2 → 3 on ours; 9x instead of 13x. The ratio moves, the verdict does not |
| 4 | Is `Response.json` a concept? | **No** — Web-standard vocabulary already in the Next.js baseline | Concepts 9 → 10; 3.33x instead of 3x |
| 5 | Is `@vercel/firewall` the Next.js side? | **No.** It is a client for a dashboard rule, is a no-op outside production, and fails open when unconfigured — the exact thing § The Next.js side excluded before the package was read | If it were, the Next.js diff is roughly 6 lines and **1 file**, and metric 1 and metric 2 both invert. It would also satisfy **none** of the five criteria off-platform, because it never refuses anything there. Choosing it would buy a smaller number by measuring something that does not run |
| 6 | Is the check placed in `proxy.ts` or in each Route Handler, given that both first-party sources show the handler? | **`proxy.ts`.** The protocol says the Next.js side is written to win where no example binds, and one file that covers both endpoints beats two edits | In handlers: 4 files (`chat`, `probe`, `package.json`, `.env.local`) and roughly 34 glue lines, because the construction and the 429 are either duplicated or extracted into a fifth file. Files 1 vs 4 and glue 2 vs 34 — the margin widens. The shorter opponent was chosen |
| 7 | `fixedWindow` or `slidingWindow` on the Next.js side? | **`fixedWindow`**, matching the Upstash/Vercel template and matching our algorithm, so the comparison is like-for-like | Identical line count. `slidingWindow` was built and run anyway (see above) and also passes criterion 3 |
| 8 | Is the flat `{ windowMs, max }` shape the TheoKit implementation, rather than the per-route shape? | **Flat**, unchanged from the section above: both satisfy the criteria and the flat one is one line | The per-route shape is a nested object: glue 2 → 3 or 4 and one more concept. 13x → ~8x. Still outside |
| 9 | Do the three `500`s on the TheoKit agent path void criterion 5? | **No.** The criterion asks that a caller exceeding the budget on the agent endpoint be refused with the same code and headers, and it was. A 500 from the provider resolver is stronger evidence the branch ran than a 200 would be | Grading them as failures makes criterion 5 **unmeasurable on our side**, and the criteria row becomes 4-of-5 against 5-of-5. It would not move a metric |
| 10 | Does the store asymmetry get scored? | **No**, per this page's own rule — recorded instead | If in-process-only were scored as a failure, TheoKit's cheaper diff would be buying a limiter with no multi-instance meaning, and the three margins would be describing different products |
| 11 | Does the `x-forwarded-for` bypass get scored against Next.js? | **No.** It is an artefact of running off-platform, and it is the idiom the official samples publish | Scoring it would give TheoKit a criterion the criteria never wrote, which is the exact failure § Why the protocol comes before the measurement exists to stop |

### Where the comparison is not apples to apples

- **Reach.** Ours is one process; theirs is a shared Redis. Same criteria, different operational
  meaning, and the rule says record it rather than score it.
- **Target.** Ours protects `theokit start`. The Web-standards factories have no production caller
  (`packages/theo/src/server/rate-limit/rate-limit.ts:105`,
  `packages/theo/src/server/rate-limit/rate-limit-per-route.ts:295`), and no adapter under
  `packages/theo/src/adapters/` references a limiter at all — the only mention is a comment
  (`packages/theo/src/adapters/web-shim.ts:136`). Theirs protects every target `next build` produces.
  One line against twenty-six is not the same purchase when one of them covers one deployment shape
  and the other covers all of them.
- **The dev/prod split.** Ours behaves differently in `theokit dev`, where the per-route shape is
  narrowed away before it reaches the limiter and the agent middleware has no rate-limit call at all
  (§ Current state). Theirs runs the same `proxy.ts` in both.
- **What a caller sees while under budget.** Ours reports the remaining budget on every response for
  free; theirs reports nothing until it refuses.

### Verdict

**All three countable metrics go to TheoKit by a margin outside the bar, both sides satisfy every
gradeable criterion, and the journey is still not won.** Files 1 against 3, glue lines 2 against 26,
concepts 3 against 9 — 3x, 13x and 3x, against a bar of 2x. It is the largest set of margins this
programme has produced on an implementation that was *run and works on both sides*, which is the
sentence J3 could not write and J9 could not write.

Two things stop it being a win, and only one of them is about the framework.

**Metric 4 is unmeasured on both sides.** § What counts as winning requires TheoKit to be better on
the three countable metrics *and not worse on time-to-green*. Unmeasured is not "not worse", and this
document does not get to treat an absent measurement as a passing one.

**And the three margins are not pricing the same purchase.** Twenty-six lines buy a Next.js
application a limiter on every target it deploys to, shared across every instance. Two lines buy a
TheoKit application a limiter on one target, private to one process, on a server where — until
[#400](https://github.com/usetheokit/theokit/issues/400) is fixed — the ordinary `POST` with a JSON
body to the protected route never returns at all. A journey is won by costing less to build the thing
the criteria describe; the criteria describe a refusal, and both sides deliver one. What they do not
describe is where that refusal is in force, and on that the cheap side is the narrow one.

So: **J7 is measured on both sides, its three countable metrics are the framework's best result so
far, and it is reported as undecided rather than won.** The honest way to close the remainder is to
measure metric 4 and to make the Web-standards handler enforce the budget it already knows how to
parse — neither of which is a counting decision.

### One of the two reasons was removed later the same day — and this is not a re-measurement

`#400` is fixed (`c4a3b4d`). `tests/integration/start-post-body-reaches-the-route.test.ts` boots the
real production request handler on a real listener and asserts the **echoed body**, not merely a
status — a fix that handed the handler an empty body would pass a status check and fails this one —
with every fetch bounded by `AbortSignal.timeout`, so a regression reads as "no response in 2000 ms"
rather than hanging the suite. Four cases, green. The clause above about a server "where the ordinary
`POST` with a JSON body to the protected route never returns at all" no longer describes the code.

**The verdict above stands unchanged, and deliberately.** Removing a stated blocker is not the same
as re-running the measurement, and editing a verdict without re-measuring is the moved target this
document refuses everywhere else. Two things still hold it open, and only one of them was #400:

- **Metric 4 is unmeasured on both sides**, so "not worse on time to first green run" is untested —
  a hole every one of the ten journeys shares, and the one that decides here.
- **The other half of "not the same purchase" was never about #400.** Our store is in-process and
  theirs is a shared Redis. That is an asymmetry of *capacity*, not of cost, and whether it is a
  reason not to win or a difference the criteria already graded — both sides passed all five — is a
  judgement a re-measurement has to make from scratch rather than inherit.

A re-measurement was started on 2026-08-20 and stopped before it built anything, so nothing here is
graded by it. What is recorded is only that one of the two named obstacles is gone.

**The re-measurement was completed on 2026-08-21 — see § Re-measured below.** It found that "gone"
overstated it: `c4a3b4d` is unreleased, so the artifact this journey grades still hangs, three times
out of three. It also measured metric 4, which clears its clause, and it withdrew the store asymmetry
as a reason while sharpening a third one this paragraph folded into it.

## Re-measured — both sides, metric 4 included (2026-08-21)

**The section above closed with two reasons and an invitation to re-measure. This is the
re-measurement.** It builds both lanes again from scratch, re-derives metrics 1-3 from fresh diffs,
re-exercises the criteria against running builds, and — for the first time on this journey — measures
metric 4 on both sides. It does not replace the 2026-08-20 sections; it says what moved.

Two of the three things that changed between the measurements were changes to *this repository's
working tree*, and neither of them is on npm yet. That distinction decides half of what follows, so it
is established by measurement before anything is concluded from it.

### What changed between the two measurements, and what did not

| | 2026-08-20 | 2026-08-21 | How it was checked |
| --- | --- | --- | --- |
| [#400](https://github.com/usetheokit/theokit/issues/400) — `POST` with a body hangs | open, reproduced | **fixed on `workspace` (`c4a3b4d`), unreleased** — still reproduces 3 of 3 on the artifact npm serves | a real `POST` over TCP against both builds, below |
| Vite major in a scaffolded app | two (`vite@6` from the framework, `vite@7` from Tailwind), two `esbuild` | **one of each on `workspace` (`d635f7fe9`), unreleased** | `npm ls esbuild vite --all` on both trees |
| The Next.js side | `next@16.3.1`, `@upstash/ratelimit@2.0.8`, `@upstash/redis@1.38.2` | **identical — all three still the current published versions** | `npm view <pkg> version`, all three |
| The store | in-process by enforcement | **unchanged** (`packages/theo/src/server/rate-limit/rate-limit.ts:53`, `packages/theo/src/server/rate-limit/rate-limit-per-route.ts:162`) | read from the working tree |
| The Web-standards handler | no limiter, no production caller | **unchanged** (`packages/theo/src/server/rate-limit/rate-limit.ts:105`, `packages/theo/src/server/rate-limit/rate-limit-per-route.ts:295`) | `grep` for callers across `packages/`, tests excluded |
| Metric 4 | unmeasured on both sides | **measured on both sides**, below | the harness at `../evidence/metric4-harness.sh` |

The Next.js side is therefore reused rather than rebuilt from zero, and the reuse is earned: the three
packages the diff depends on are byte-for-byte the versions the previous measurement installed, and the
lane's own git history still shows the same baseline and the same 26-line delta with nothing on top.
`ai` and `@ai-sdk/react` moved by one patch each (7.0.70 → 7.0.71, 4.0.73 → 4.0.74); both are baseline
dependencies counted on neither side, and neither is imported by the rate-limit diff.

### #400 is fixed in the tree and still shipping broken, and the difference is the whole point

The previous verdict's parenthetical — a server "where the ordinary `POST` with a JSON body to the
protected route never returns at all" — was checked against both artifacts rather than against the
commit. One `POST` carrying `{"hello":"world"}` to an `/api` file route, bounded at 8 s, three times
each:

| | `theokit@0.48.14` (npm, what `create-theokit` installs today) | `theokit@0.49.0` (this worktree, contains `c4a3b4d`) |
| --- | --- | --- |
| run 1 | no response, aborted at 8001 ms | **200 in 5 ms**, body echoed back verbatim |
| run 2 | no response, aborted at 8001 ms | **200 in 5 ms**, body echoed |
| run 3 | no response, aborted at 8000 ms | **200 in 5 ms**, body echoed |
| `GET` on the same server afterwards | 200 in 3 ms | 200 |

The fix works, and the regression test that guards it
(`tests/integration/start-post-body-reaches-the-route.test.ts`) asserts the echoed body rather than the
status, so a fix that delivered an empty body would not pass it. What the fix is not is *shipped*:
`c4a3b4d` is dated after both the `0.48.14` release npm serves and the unpublished `0.49.0` release
commit, and [#400](https://github.com/usetheokit/theokit/issues/400) is still open. § Acceptance
criteria grades this journey **against a published build**. On that artifact the sentence the previous
verdict wrote is still true, measured today, three times out of three.

So the first of the two stated reasons is discharged *in the code* and is not yet discharged *in the
artifact this journey grades*. Both halves are recorded because collapsing them is how a fix comes to
be credited twice.

### Metric 4 — measured, and the previous protocol had an asymmetry in it

Same harness as J9 (`../evidence/metric4-harness.sh`), same definition: a clean copy of each side's
committed source, no `node_modules`, no build output, through install → build → start → first
successful HTTP response, probing `/` on both sides so no lane needs its store to answer. Warm npm
cache, stated rather than hidden, exactly as J9 declared it. Every run below, including the six that
failed and were discarded, is in `../evidence/j07-metric4-2026-08-21.txt`.

**One thing was checked before any number was reported, and it changed the protocol.** J9's two source
trees were not symmetric: `j09-next` carries a `package-lock.json` and `j09-theo` does not. A tree with
a lockfile installs from it; a tree without one re-resolves the whole dependency graph against the
registry on every run. Both scaffolders write a lockfile — `create-next-app` and `create-theokit`
alike — so the tree without one is the anomaly, not the tree with one. Every number below is therefore
reported **both ways, on both sides**, and the asymmetry is priced rather than argued.

#### With each tree's own lockfile — six runs per side, interleaved

| run | Next.js + `@upstash/ratelimit` | TheoKit `0.48.14` |
| --- | --- | --- |
| 1 | 12.9 s | 12.7 s |
| 2 | 13.9 s | 14.5 s |
| 3 | 15.7 s | 14.5 s |
| 4 | 13.0 s | 11.5 s |
| 5 | 14.5 s | 12.3 s |
| 6 | 18.3 s | 12.5 s |
| **mean ± 1σ** | **14.72 ± 2.04** → [12.68, 16.75] | **13.00 ± 1.23** → [11.77, 14.23] |

Runs 4-6 were taken alternating lane by lane rather than three of one then three of the other, so any
drift in machine load falls on both columns.

**The intervals overlap, and TheoKit's mean is the lower one.** By § What counts as winning's own test
— non-overlapping intervals at ±1σ over ≥ 3 runs — TheoKit is **not worse on time to first green run**.
It is also not *better* by that test, because the same overlap that clears "not worse" denies "outside
noise"; the winning rule asks only for the first.

| phase, mean ± 1σ | Next.js | TheoKit |
| --- | --- | --- |
| install | 5.18 ± 0.66 | 6.13 ± 0.79 |
| build | 8.95 ± 1.42 | **5.77 ± 0.53** |
| start | 0.65 ± 0.12 | 1.05 ± 0.05 |

TheoKit installs about a second slower and builds about three seconds faster, and the build is the
larger term. That is the same shape J9 found on the build half and the opposite of what it found on the
install half.

#### Without a lockfile on either side — J9's protocol, applied symmetrically

| | Next.js | TheoKit |
| --- | --- | --- |
| runs | 20.9, 19.2, 18.4 | 23.4, 22.6, 19.5 |
| **mean ± 1σ** | **19.50 ± 1.28** → [18.22, 20.78] | **21.83 ± 2.06** → [19.77, 23.89] |
| install, mean | 10.33 | 15.10 |

Removing the lockfile costs TheoKit 8.97 s of install and Next.js 5.15 s — both real, neither free, and
the difference between them is roughly 3.8 s that J9's protocol charged to one side only. Even so the
intervals still overlap (19.77 < 20.78), so **the verdict is the same under either protocol**: not
worse. That matters more than which protocol is right, because it means the conclusion does not rest on
the protocol correction.

#### What this does and does not say about J9

It does not restore J9's win. J9's number was measured on a different pair of applications, and nothing
here re-runs it. What it says is narrower and still worth saying: **J9's 30.40 ± 7.50 s was measured
with a handicap on one side**, and this journey's own numbers, measured symmetrically, do not reproduce
its gap on either protocol. J9's § Metric 4 has been annotated accordingly rather than rewritten, and
its number stands as what was measured until somebody re-runs it.

The other half of the divergence is the machine, and it is stated rather than defended. This
measurement ran after the same trees had been installed a dozen times in the same session, so the npm
cache and the node-gyp header cache are warmer than they were for J9. `node-pty` ships prebuilt
binaries for `darwin-*` and `win32-*` and **none for `linux-x64`**, so `node scripts/prebuild.js ||
node-gyp rebuild` really does compile on this platform every time — it just compiles fast when the
headers are already local. Neither this measurement nor J9's timed a cold machine, and neither should
be read as one.

#### The install decomposition, re-run with lockfiles

Two runs per cell, mirroring `../evidence/b025-install-decomposition-2026-08-20.txt` so the two are
comparable:

| | with scripts | `--ignore-scripts` | scripts cost |
| --- | --- | --- | --- |
| TheoKit | 5.0 s, 5.3 s | 3.1 s, 3.1 s | ~2.1 s |
| Next.js | 4.7 s, 5.9 s | 5.1 s, 4.1 s | ~0 s (it declares none) |

The published decomposition put TheoKit's script cost at 19.8 s and its `--ignore-scripts` floor at
10.5 s. Both figures were taken on a tree with no lockfile, and both collapse when the lockfile is
present and the caches are warm. The *shape* survives — TheoKit pays for lifecycle scripts and Next.js
pays for none — and its magnitude does not. `B-025` is still worth closing; what it is worth is smaller
than 19.8 s under this protocol, and nobody has yet measured either number on a cold machine, which is
where a new developer actually stands.

### Did Vite 7 move our number? Measured, and no — not under this protocol

`d635f7fe9` changes one field of one manifest (`"vite": "^6.4.3"` → `"^7.0.0"`) and nothing else. To
isolate it, the worktree's `theokit` was packed twice into two tarballs differing in exactly that field
and nothing else, and installed into two copies of the same application. The dependency claim holds
outright:

| | `vite@^6.4.3` | `vite@^7.0.0` |
| --- | --- | --- |
| `vite` majors in the tree | 2 (`6.4.3` + `7.3.6`) | **1** (`7.3.6`) |
| `esbuild` copies | 2 (`0.25.12` + `0.28.2`) | **1** (`0.28.2`) |
| packages installed | 386 | **383** |

The time claim does not:

| | `vite@^6.4.3` | `vite@^7.0.0` |
| --- | --- | --- |
| runs | 13.0, 11.3, 11.1 | 10.8, 10.8, 12.7 |
| **total, mean ± 1σ** | **11.80 ± 1.04** | **11.43 ± 1.10** |
| install, mean | 5.40 | 5.00 |

**0.37 s on the total and 0.40 s on install, against σ of about 1 s on each side — inside noise.** The
second `esbuild` costs 11 MB on disk and one more `postinstall`, and on a warm cache that
`postinstall` unpacks a tarball npm already holds. This is a real saving in tree size that this
protocol cannot see as time, and the honest report is the negative result rather than the disk figure
standing in for it. What it would be worth on a cold cache — where the second `esbuild` must fetch its
platform binary over the network — is **not measured here, on either side**.

Both lanes carry a caveat worth stating: `theokit@0.49.0` needs `@theokit/agents` from the same
worktree, because its client imports `AgentStreamInterruptedError`, which published
`@theokit/agents@10.1.0` does not export — the two carry the same version number and different
exports. The first attempt at this lane installed worktree `theokit` against npm `@theokit/agents`
and the client bundle failed on that import, which cost six runs. **This is an artefact of packing a
pre-release tree by hand, not a defect**: `.changeset/agent-stream-interrupted.md` declares a minor
bump on both packages, so a real release ships them together and the `workspace:^` range resolves to
the bumped version. It is recorded because the next person to pack this repository by hand will hit
it, and because `npm pack` does not rewrite pnpm's `workspace:` protocol the way publishing does.

### Metrics 1-3, re-derived from fresh diffs

Both counts come from `git diff --numstat` over a committed untouched baseline, formatted with the
`create-theokit` Prettier config on both sides, exactly as the section above describes.

| Metric | TheoKit | Next.js + `@upstash/ratelimit` | Margin | Bar |
| --- | --- | --- | --- | --- |
| Files touched | **1** | **3** | 3x | ≥ 2x — **outside** |
| Glue lines | **2** | **26** | 13x | ≥ 2x — **outside** |
| Concepts required | **3** | **9** | 3x | ≥ 2x — **outside** |
| Time to first green run | **13.00 ± 1.23 s** | **14.72 ± 2.04 s** | intervals overlap | **not worse** |

The TheoKit diff re-derived here from a fresh `create-theokit@latest` scaffold is `3 1 theo.config.ts`
— three lines added, one removed, character for character what the previous measurement published. The
Next.js diff is `26 0 proxy.ts`, `2 0 package.json`, `2 0 .env.local`, unchanged in its lane's git
history. Nothing in the counting moved, and the eleven declared judgements of § Declared judgements
apply unchanged.

### The criteria, re-exercised against running builds

Three runs per lane, budget `max: 3` over a 5 s window on both sides, the same side-effect recorder on
`:4311` for every lane. A third lane was added: the same TheoKit application against the worktree
build, which is the only one that can be probed the way the Next.js lane is probed.

| # | Criterion | TheoKit `0.48.14` (published) | TheoKit `0.49.0` (worktree) | Next.js + `@upstash/ratelimit` |
| --- | --- | --- | --- | --- |
| 1 | N succeeds, N+1 refused, on the boundary | **PASS** — `200, 200, 200, 429`, 3/3 runs | **PASS** — same, and the probe is a `POST` **carrying a JSON body** | **PASS** — `200, 200, 200, 429`, 3/3 |
| 2 | machine-readable, dedicated code from the parsed body | **PASS** — `{"error":{"code":"RATE_LIMITED",…}}` | **PASS** — same | **PASS** — same code, application-authored |
| 3 | retry-after present, wait performed, follow-up succeeds | **PASS** — `Retry-After: 5`, all 3 runs; deadline−1.2 s still `429`; after the wait `200` | **PASS** — same | **PASS** — `Retry-After: 3, 3, 2` across runs, which varies with position in the fixed window and is correct; deadline−1.2 s still `429`; after the wait `200` |
| 4 | the refused request did no work | **PASS** — recorder holds **3**, then **4** | **PASS** — same, for a refused `POST` with a body | **PASS** — **3**, then **4** |
| 5 | same refusal on the agent path | **PASS** — `500, 500, 500, 429`, headers byte-identical to the plain route | **PASS** — `400, 400, 400, 429`, headers byte-identical | **PASS** — `200, 200, 200, 429`, the three 200s streaming a real mock run; same three header names, `Retry-After` differing by window position |
| 6-8 | Web, Tauri, TUI exercised | **not exercisable here** | **not exercisable here** | **n/a** — a TheoKit-transversal rule |

Every row agreed across all three runs of every lane. The three non-`429` statuses on each TheoKit
agent lane are the provider resolver and the request validator respectively — both prove the agent
branch **ran**, which is what criterion 5 needs from them, and the `429` arrives in 3-4 ms without
either.

**The honest tally is five of eight, not five of five.** Criteria 6, 7 and 8 have never been gradeable
in this repository, and § What is still unmeasured, and why said so before any number existed. Reading
three ungradeable criteria as a clean sweep is the same move as reading an unmeasured metric 4 as "not
worse", and this document refused that one.

### "Not the same purchase" — argued from scratch

The previous verdict held the journey open on a single sentence that turns out to carry three
different claims. Separating them is most of the work, because they are not graded the same way.

**Claim 1 — the store is in-process and theirs is shared.** This is an asymmetry of *capacity*, and it
is **not a reason to withhold the win**. § How the four metrics are counted here settled it before
either implementation existed: "Provisioning a store counts as glue on the side that needs one, and its
absence counts as zero on the side that does not, with the operational difference recorded rather than
scored." That rule was written into the criteria, ahead of the code, precisely so that the side without
a store could not be charged for not having one after the numbers arrived. Scoring it now is adding a
criterion after the fact — the same failure judgement 11 refused in the other direction when it
declined to charge Next.js for the `x-forwarded-for` bypass.

The J3 test is the one worth applying, and it does not catch this. J3 refused an 8.8x margin because
its lines priced code whose trigger never fires. These two lines price a limiter that **was run** and
that refused real requests over HTTP, three runs, two builds. A limiter that holds on one process is
not a limiter that does not work; it is a limiter with a smaller operating envelope, and the envelope
was stated in the criteria before it was measured.

There is a sharper form of the objection and it should be answered rather than skipped: the in-process
store is not merely absent, it is *refused* — every shipped factory throws when handed anything else,
so a developer who outgrows one instance cannot buy the Next.js capability at any price inside the
framework's own API. That is true, and it is a limit on what is *purchasable*, not on what these two
lines purchased. It belongs in the roadmap, and the second break in § The deliberately broken state
already grades the silent version of it. It is not a counting decision and it does not move a metric.

**Claim 2 — the protected server could not take a `POST` with a body.** Measured above: fixed in the
tree, unfixed in the artifact this journey grades, three times out of three. It is a release away from
being discharged, and until the release it is not discharged.

**Claim 3 — ours protects one target and theirs protects every target.** This is the one that survives,
it is J3-shaped, and it was buried inside a sentence about stores. The two lines are read by the Node
production server. The Web-standards rate-limit factories still have **no production caller**
(`packages/theo/src/server/rate-limit/rate-limit.ts:105`,
`packages/theo/src/server/rate-limit/rate-limit-per-route.ts:295`), and the six deploy adapters built on
the Web shim — `vercel`, `cloudflare`, `netlify`, `bun`, `deno-deploy`, `aws-lambda` — contain no
reference to a limiter at all; the only mention anywhere under `packages/theo/src/adapters/` is a
comment (`packages/theo/src/adapters/web-shim.ts:136`). On those six targets the declared budget is
parsed and no limiter is constructed: the same line, the same config key, and nothing refuses anything.
That is J3's failure exactly — lines that price a trigger which never fires — and it is not softened by
being true on a seventh target where it does fire.

It is also not a new criterion smuggled in after the fact. Criterion 6 asks that the budget hold on
**Web**, and criteria 6-8 have been ungradeable here since before the first number. What the source
says is not a substitute for grading them; but a limiter that is never constructed cannot limit, and a
journey does not get to count an unbuildable criterion as satisfied while refusing to count an
unmeasured metric as passed.

### Verdict — 2026-08-21

**Metric 4 no longer holds this journey open. One reason does, and it is a different one from the two
that were named.**

The scorecard, with everything measured today:

| | Result |
| --- | --- |
| Files touched | 1 against 3 — **3x, outside the bar** |
| Glue lines | 2 against 26 — **13x, outside the bar** |
| Concepts required | 3 against 9 — **3x, outside the bar** |
| Time to first green run | 13.00 ± 1.23 s against 14.72 ± 2.04 s — intervals overlap, **not worse**, and the same conclusion holds without lockfiles on either side |
| Gradeable criteria | **5 of 5 against 5 of 5**, exercised on published builds |
| Ungradeable criteria | **3**, all on the TheoKit side (Web, Tauri, TUI) |

Three margins outside the bar and a fourth metric that clears its clause. That is the whole winning
rule satisfied on the arithmetic, and it is the first time any of the ten has got here.

**It is still reported as not won, on one claim of the three the old sentence contained.** The two
lines buy a limiter on `node`, the one target `theokit start` serves. On the six adapters built on
the Web-standards handler, the identical line declares a budget that nothing reads — parsed, validated,
and never handed to a limiter, because the Web-shaped factories have no caller. Twenty-six lines of
`proxy.ts` run wherever `next build` deploys. A journey is won by costing less to build *the thing the
criteria describe*, and criterion 6 describes it holding on Web.

The store asymmetry is **withdrawn as a reason**, with the argument above and against this document's
own pre-committed counting rule. The `POST`-with-a-body clause is **discharged in the code and pending
a release**. What is left is a structural gap, not a mechanical one — see § Correction below, which
measured the sentence this paragraph originally carried and refuted it.

**So: J7's three countable metrics are the framework's best result, metric 4 clears its clause on both
protocols, both sides pass every gradeable criterion, and the journey is reported as not won because
the cheap side protects `node` and none of the six adapters built on the Web-standards handler.**

### Correction, later on 2026-08-21: "cheap and mechanical" was measured and is false

The verdict above originally closed on this sentence: *"What is left is a single, cheap, entirely
mechanical gap: give the Web-standards handler the limiter it already knows how to construct."* It
was written from a reading of the source, not from a run. It was then measured, and it is wrong in
three places. The sentence is corrected in place and recorded here rather than deleted, because a
verdict that quietly loses a claim it once made is a verdict nobody can audit.

**First, there is no Web handler in the path.** Each generated entry wraps the request in
`createWebShim` (`packages/theo/src/adapters/web-shim.ts:401`) and calls the **Node** `executeRoute`
(`packages/theo/src/adapters/vercel.ts:80`). So the adapters already inherit CSRF
(`packages/theo/src/server/http/execute.ts:242`), route policy (`:303`), file middleware (`:176`) and
Zod validation (`:275`) — four of the executor's concerns reach every deploy target, which the
verdict above did not credit. `createRouteRateLimiter`, the factory `theokit start` itself uses
(`packages/theo/src/cli/commands/start/index.ts:130`), runs unaltered on the shim's `req`. The two
Web mirrors (`packages/theo/src/server/rate-limit/rate-limit.ts:105`,
`packages/theo/src/server/rate-limit/rate-limit-per-route.ts:295`) are not the thing to wire; they
are the flat single-bucket shape this journey's own § The deliberately broken state scores as a
failure.

**Second, what is missing is the client address, and it is not mechanical.** The shim's default
policy consults `cf-connecting-ip` only (`packages/theo/src/adapters/web-shim.ts:143`), and only the
Cloudflare entry passes a policy at all (`packages/theo/src/adapters/cloudflare.ts:148`). Wiring
`createRouteRateLimiter` naively into the other five was run rather than argued — three distinct
clients, per-route config, against the real sources:

| entry | resolved IP | third request from a *different* client |
| --- | --- | --- |
| vercel | `0.0.0.0` | refused |
| netlify | `0.0.0.0` | refused |
| aws-lambda | `0.0.0.0` | refused |
| cloudflare | `203.0.113.7` / `198.51.100.42` | correctly separated per client |

**Five of six targets collapse into one global bucket**, where any single caller exhausts the budget
for the entire internet — the self-inflicted denial of service that
`packages/theo/src/server/rate-limit/client-ip.ts:8` names in prose. That is worse than shipping no
limiter. Three of the six addresses are not headers at all: Netlify's arrives in a handler `context`
that the entry receives and drops (`packages/theo/src/adapters/netlify.ts:45`), Lambda's in
`event.requestContext.http.sourceIp`, discarded while building the `Request`
(`packages/theo/src/adapters/aws-lambda.ts:104`), and Bun's from `server.requestIP(request)`, in
scope and unused (`packages/theo/src/adapters/bun.ts:87`).

**Third, the configuration does not reach the entry.** The entries are string templates with no
runtime access to `theo.config.ts`. Embedding the budget as a build-time literal meets two values
that do not survive serialization: `keyBy` may be a function
(`packages/theo/src/server/rate-limit/rate-limit-per-route.ts:28`) and `store` is an object (`:42`).
That is a design decision with a named refusal, not a line of wiring.

And after all of it, `InMemoryStore` is per isolate, and both factories throw for any other store
(`packages/theo/src/server/rate-limit/rate-limit.ts:54`,
`packages/theo/src/server/rate-limit/rate-limit-per-route.ts:162`). On Vercel, Lambda, Cloudflare and
Netlify the honest description of the finished work is "a limiter that does not limit across
instances".

**Honest cost:** days to a week — a shared helper, six per-platform address decisions each carrying a
trust judgement, config transport with an explicit refusal, and per-runtime tests. Not one line. The
security-header half of the same gap *is* mechanical (`buildSecurityHeaders` is a pure function), and
a build-time warning for configuration that is parsed and never applied is cheaper still and worth
more than either.

**What the measurement also found, against my own framing.** `createApiMiddleware` is mounted only
from the Vite `configureServer` hook (`packages/theo/src/vite-plugin/configure-server-hook.ts:119`),
so it is the **dev** server, not "the Node path". `theokit start` runs a separate pipeline
(`packages/theo/src/cli/commands/start/request-handler.ts:219`) which is itself weaker than dev on
CORS, batching and the CSP-report endpoint. There are three request paths in this framework, not two,
and every earlier sentence in this journey that says "Node" means the third one.

Filed from this measurement: `usetheokit/theokit#409` (`security.cors` is read only by the dev
server) and `usetheokit/theokit#410` (the six entries build `executeRoute`'s context from 8 of its 12
fields, so CSRF mode, `disallowed`, plugin hooks and the `serialization` transformer silently revert
to defaults on every deploy target). The rate-limit and security-header halves are tracked privately
as `GHSA-87qq-fgcr-384x`.


## The deliberately broken state

Per `../dx-benchmark.md` § The fifth, which is pass/fail and not a number. The break for J7 is a
**budget declared in a shape the runtime does not consume** — not a hypothetical, as § Current state
records.

| | |
| --- | --- |
| Names the action | `rateLimit was declared with per-route rules, but this server consumes only the flat { windowMs, max } shape — nothing is being limited. Use the flat shape here, or run the production server, which reads per-route rules.` — names what was declared, what was read, the consequence, and both fixes |
| Does not name the action | Nothing at all: the server starts, every request succeeds, and the developer discovers the gap from a bill or an incident |

**This is the second journey where the realistic break produces no error site**, and it is graded
the same way J8 establishes: a silent wrong outcome scores **fail** on the fifth metric rather than
being excused as unmeasurable. The repository has already paid for this exact failure once — the
production path carries a comment recording that a per-route configuration used to produce a null
limiter and nothing was limited, silently
(`packages/theo/src/cli/commands/start/index.ts:117`).

A second break is graded in the same transcript, because it is the one that shows up under load:
**a limiter whose store is process-local behind more than one instance.** Names the action:
`rate limiting is using the in-process store; with 3 instances each caller gets 3x the declared budget. Configure a shared store.`
Does not: correct-looking behaviour on one instance and a budget that quietly multiplies on the
others.

## Current state and blockers

Measured against the working tree on 2026-08-20; every claim is read from source.

**Nothing blocks J7 from running. Criterion 5 fails in one of the two modes, and criterion 1 fails
entirely on the Web-standards handler — both are measured defects rather than missing features.**

What is wired, and it is a real limiter:

- A public surface with per-route rules and pluggable key derivation
  (`packages/theo/src/server/rate-limit/rate-limit-per-route.ts:151`, key derivation at `:118`),
  exported from the server barrel (`packages/theo/src/server/rate-limit/index.ts:1`).
- Declared in configuration under a `rateLimit` key
  (`packages/theo/src/config/schema.ts:143`, shape at
  `packages/theo/src/config/schemas/rate-limit.ts:16`) — so criterion 1's "declared" is satisfiable.
- Enforced across four branches of the production server, including the agent routes and the
  approval endpoint (`packages/theo/src/cli/commands/start/handlers.ts:92`, applied at `:115`,
  `:224`, `:277`, `:406`).
- The refusal is a rate-limit status with a dedicated error code
  (`packages/theo/src/core/contracts/envelope-code-to-status.ts:25`) and a retry-after header on the
  refused response (`packages/theo/src/server/rate-limit/rate-limit-per-route.ts:210`), inside the
  framework's standard error envelope
  (`packages/theo/src/server/http/send-response.ts:123`). Criteria 2 and 3 have real material.

Three findings that shape what the run will show:

- **The algorithm is a fixed window, not a sliding one**
  (`packages/theo/src/server/rate-limit/rate-limit-store.ts:97`). Criterion 1's boundary test passes
  on a fixed window; the burst-at-the-seam behaviour it permits is not graded here, and is recorded
  so the comparison against a sliding-window library is not read as like-for-like.
- **The store is in-process only, by enforcement rather than by omission.** The store interface is
  async and Redis-shaped (`packages/theo/src/server/rate-limit/rate-limit-store.ts:27`), but every
  shipped factory throws when handed anything other than the in-memory implementation
  (`packages/theo/src/server/rate-limit/rate-limit.ts:53`,
  `packages/theo/src/server/rate-limit/rate-limit-per-route.ts:162`). A multi-instance deploy has no
  shared budget. This is the asymmetry the Next.js section says must be stated rather than scored.
- **The Web-standards handler has no rate limiting at all.** The web-shaped factories
  (`packages/theo/src/server/rate-limit/rate-limit.ts:105`,
  `packages/theo/src/server/rate-limit/rate-limit-per-route.ts:295`) have no production caller —
  their only references outside `src` are tests. So the deploy targets built on the web handler are
  unprotected, which puts criterion 1 and criterion 5 in direct tension with J10: the journey passes
  on the Node server and fails on the adapters. The benchmark must record which target it measured.

**Criterion 5's live gap: the dev server does not limit agent routes.** In dev the flat, IP-only
facade is used (`packages/theo/src/vite-plugin/api-middleware.ts:315`), the per-route shape is
narrowed away before it gets there (`packages/theo/src/cli/commands/dev.ts:63`), and the agent
middleware is registered before the API middleware and contains no rate-limit call
(`packages/theo/src/vite-plugin/configure-server-hook.ts:101`). Since acceptance grades the
**published build** and not the dev server, this does not block the journey — it is recorded because
a developer's first encounter with the limiter is in dev, and a limiter that behaves differently
there is a DX finding in its own right.

**On budgets that are not requests:** the token/cost budget is a different mechanism and it is
worth separating. The recording-only cost module has zero production callers
(`packages/theo/src/server/cost/track-agent-run.ts:49`, exported at
`packages/theo/src/server/cost/index.ts:11`) and never throws by design. The *enforcing* budget lives
in the guardrails — a cumulative token ceiling that rejects rather than warns
(`packages/agents/src/guardrails/detectors.ts:114`), with a non-retryable error whose reason is
stated (`packages/agents/src/guardrails/types.ts:87`), mapped to the same rate-limit status on the
wire (`packages/theo/src/core/contracts/server-error-to-envelope.ts:48`). J7 grades the request
budget; the token budget is noted here so a later reader does not conclude it was missed.

**Not measured:** behaviour under concurrent load, and whether the fixed window's seam is reachable
in practice. Both are out of this journey's scope by the exclusion stated in § Acceptance criteria.

## Cross-references

- The benchmark this journey belongs to: `../dx-benchmark.md`
- The journey whose refusal must not be retried: `j06-retry.md`
- The journey whose targets are unprotected today: `j10-deploy.md`
- Transversal target rule criterion 7 and 8 enforce: `../three-target-parity.md`
- Acceptance contract that grades these criteria: `../../../.claude/rules/cycle-acceptance.md`
- Criterion shape these follow: `../../../ROADMAP.md` § Wave 1
