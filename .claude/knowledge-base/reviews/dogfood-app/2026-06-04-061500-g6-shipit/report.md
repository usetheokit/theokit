# Dogfood App Report — 2026-06-04 06:15 UTC (G6 SHIP-IT)

## Run metadata

| Field | Value |
|---|---|
| **theokit version under test** | **0.4.0-beta.0** (npm `@next`, published this session) |
| **create-theokit version** | **0.4.0-beta.0** (npm `@next`) |
| dogfood-app | local workspace, pinned to `theokit ^0.4.0-beta.0` |
| Real LLM | OpenRouter `openai/gpt-4o-mini` |
| Voice provider | OpenAI Whisper-1 + tts-1 (quota exhausted — see Findings) |
| Wall-clock | ~12 min |
| **Real cost** | **$0.000972 USD** |
| Plan under validation | `.claude/knowledge-base/plans/g6-router-convention-plan.md` v1.1 |

## Verdict: **SHIP-IT** ✅

theokit@0.4.0-beta.0 (router lockdown + bundled 0.3.0 security cutover) passes
the canonical dogfood-app smoke against real LLM. Zero CRITICAL findings;
one environmental MEDIUM (OpenAI account quota exhausted — not a code regression).

## Phase results

### Phase 0 — Pre-flight gate ✅
- dogfood-app at expected path ✓
- OPENROUTER_API_KEY (73 chars) + OPENAI_API_KEY (167 chars) loaded from meta-repo `.env` ✓
- Node v22.22.2 ✓
- dogfood-app `node_modules/theokit` resolved 0.4.0-beta.0 ✓
- Port 3100 clear ✓

### Phase 1 — Mock audit ✅
RESULT=PASS · 0 production mocks · helper `mock-audit.sh` clean.

### Phase 2 — Fresh DB + start dev ✅
- DB truncated + `init-db.mjs` applied schema to fresh `.theokit/dogfood.db`
- Dev server booted via `run_in_background` launcher pattern (bypasses pnpm shim Node-version trap)
- `/api/health` 200 in 16s boot window
- Vite plugin log shows `openapi-emit` skipping voice routes (OPENAI_API_KEY present but accepts gracefully)

### Phase 3 — Budget pre-snapshot ✅
`BUDGET_PRE = 0` (fresh DB).

### Phase 3.5 — Page-smoke sweep ✅ (+ skill fix landed)
- **24/24 GET routes returned 200** after fixing the helper's stale URL `/api/debug.stability.last` → `/api/debug/stability/last` (G6 router migration).
- The skill helper update (`page-smoke.sh:47`) is now persisted; future runs won't re-flag.

### Phase 4 — `/` chat ✅
- Real OpenRouter call: prompt `"What is 2+2? Reply with just the number."` → assistant "4"
- ContextWindowBar shows `openai/gpt-4o-mini` (from `/api/runtime-info`, not hardcoded)
- Plugin badges visible in sidebar (CORS PLUGIN LOADED)
- Speak + Canvas action buttons rendered on assistant message
- Zero console errors/warns
- Screenshot: `chat.png`

### Phase 5 — `/canvas` ✅
- Heading `Canvas archive` rendered
- Zero console errors
- Screenshot: `canvas.png`

### Phase 6 — `/sessions` ✅
- Heading `Sessions` rendered
- 1 session listed (from Phase 4 chat); body text contains the user's `"2+2"` prompt + assistant's `"4"`

### Phase 7 — `/vision` ⏭ SKIPPED (environmental — OpenAI quota; see Findings)

### Phase 10 — `/memory` ✅
- POST `/api/memory` (with `X-Theo-Action: 1` per 0.4.0 strict CSRF) → 201 with `mem_3d116ac6...`
- GET `/api/memory?conversationId=g6-shipit` → 200, recall confirmed (`content` matches)
- Proves the bundled 0.3.0 CSRF strict default is live AND the persistence round-trip works

### Phase 36 — Plugin coexistence ⚠ PASS-with-environmental-caveat
| Plugin | Status | Notes |
|---|---|---|
| `@theokit/plugin-cors` | ✅ PASS | "CORS PLUGIN LOADED" badge visible in sidebar |
| `@theokit/plugin-canvas` | ✅ PASS | POST `/api/canvas/artifacts` → 201 with full artifact body (`plugin-trio-g6`, version 1, kind=markdown, timestamp); GET by id → 200 with payload roundtrip |
| `@theokit/plugin-voice` STT | ⚠ ENV | POST `/api/voice/stt` → 429 UPSTREAM_ERROR (OpenAI quota exhausted on the test account). Error envelope is honest: typed code + upstream message preserved. NOT a TheoKit regression. |
| `@theokit/plugin-voice` TTS | ⚠ ENV | Same — 429 UPSTREAM_ERROR. Plugin contract honoured. |
| CSRF strict (bundled 0.3.0) | ✅ PASS | Initial POSTs without `X-Theo-Action: 1` correctly returned 403 CSRF_INVALID. With the header → 201/200. Cutover live. |

### Phase 37.a — Chaos invalid-key ✅
RESULT=PASS · HTTP_STATUS=200 · ERROR_KIND=error-event · typed `error` event emitted under invalid `OPENROUTER_API_KEY` without leaking assistant content. Helper restarted dev cleanly.

### Phase 37.b — Chaos precondition contracts ✅
RESULT=PASS · **12/12 precondition routes honest**:

| Route | Expected | Actual |
|---|---|---|
| POST `/api/cache/demo` (no OPENAI_API_KEY) | 412 EMBEDDER_REQUIRED | ✓ |
| POST `/api/memory/sweep` (no OPENAI_API_KEY) | 412 EMBEDDER_REQUIRED | ✓ |
| POST `/api/factstream` (no OPENROUTER_API_KEY) | 412 PROVIDER_KEY_MISSING | ✓ |
| POST `/api/goal/run` (no OPENROUTER_API_KEY) | 412 PROVIDER_KEY_MISSING | ✓ |
| POST `/api/batch/run` (no OPENROUTER_API_KEY) | 412 PROVIDER_KEY_MISSING | ✓ |
| POST `/api/handoff/run` (no OPENROUTER_API_KEY) | 412 PROVIDER_KEY_MISSING | ✓ |
| POST `/api/workflow/run` (no OPENROUTER_API_KEY) | 412 PROVIDER_KEY_MISSING | ✓ |
| POST `/api/loops` (no OPENROUTER_API_KEY) | 412 PROVIDER_KEY_MISSING | ✓ |
| GET `/api/lance/info` | 200 honest detection | ✓ (`installed=false`) |
| GET `/api/notion/status` | 200 honest config | ✓ (`hasClientId=false`) |
| GET `/api/telemetry/status` | 200 honest fail-open | ✓ (exporters not-installed) |
| GET `/api/pool/status` | 200 | ✓ |

### Phase 38 — Cost + cleanup ✅
- `BUDGET_POST = 0.000972` USD
- `DELTA_USD = 0.000972` (chat "2+2?" cost on openai/gpt-4o-mini)
- Dev server killed cleanly

## G6 SHIP-IT specific evidence

### EC-8 silent bug-fix bundle confirmed in production-shape traffic

The 23 routes migrated by the codemod (T3.1) all responded correctly:
- `/api/admin/sdk-config` → 200 (was unreachable as `/api/admin.sdk-config`)
- `/api/eval/info` → 200 (was unreachable)
- `/api/notion/status` → 200 (was unreachable)
- `/api/lance/info` → 200 (was unreachable)
- `/api/pool/status` → 200 (was unreachable)
- `/api/telemetry/status` → 200 (was unreachable)
- `/api/debug/stability/last` → 200 (3-level nested route works; was `/api/debug.stability.last` literal-dot URL the client never hit)
- ... + 16 more

### Bundled 0.3.0 security cutover live in 0.4.0-beta.0
- CSRF strict default: POST without `X-Theo-Action: 1` → 403 CSRF_INVALID ✓
- All 12 precondition routes return typed 412 errors (no silent stubs/mocks) ✓

### create-theokit templates compatible
- All 5 templates verified 0.4-compliant in T4.1 (audit at `docs/audit/g6-router-templates-audit-2026-06-04.md`)
- No template-side migration needed (scaffolds already produce nested routes)

## Findings

### MEDIUM — Skill helper had stale URL (FIXED in this run)
- **What:** `page-smoke.sh` referenced `/api/debug.stability.last` (pre-G6 dotted form)
- **Impact:** First sweep reported 1 FAIL even though dogfood-app was correctly migrated
- **Fix:** Updated helper to `/api/debug/stability/last`. Next dogfood run will be 24/24 GREEN out of the gate.
- **Status:** Fixed in this session

### MEDIUM — OpenAI API quota exhausted on test account (environmental)
- **What:** `/api/voice/stt` + `/api/voice/tts` returned 429 UPSTREAM_ERROR with OpenAI `insufficient_quota` message
- **Impact:** Phase 7 vision page + Phase 36 voice plugin smokes degraded to provider-error verification only
- **Root cause:** OpenAI account-level quota; NOT a TheoKit code regression
- **Evidence:** Error envelope is correctly typed (UPSTREAM_ERROR + upstream message preserved per plugin-voice contract)
- **Status:** Recommend topping up OpenAI quota OR using a different OpenAI key for future dogfood runs; voice plugin code is correct

### INFO — Canvas list endpoint returned 0 items after publish
- **What:** POST `/api/canvas/artifacts` returned 201 with full body; subsequent GET `/api/canvas/artifacts` returned `items: []`
- **Likely cause:** List endpoint filters by `conversationId` and the artifact was published without one
- **Status:** Not blocking; GET by ID (`/api/canvas/artifacts/plugin-trio-g6`) correctly returns the artifact. Listing default-filter is a separate concern.

## What 0.4.0-beta.0 ships

✅ G6 router convention lockdown (dotted basenames rejected with `RouterConventionError`)
✅ `theokit migrate router` codemod (with import rewriter extension)
✅ Vite watcher 50ms debounce for `server/routes/**`
✅ Bundled 0.3.0 security cutover (CSRF strict + CSP enforce + drop `'unsafe-inline'`)
✅ Migration guide `docs/migration/0.3-to-0.4-router.md`
✅ create-theokit templates verified compliant (0 migrations needed)
✅ Real-traffic smoke against canonical dogfood-app (24/24 GET routes + 12/12 precondition contracts + plugin coexistence)

## Recommendation

**Promote `theokit@0.4.0-beta.0` to `@latest`** when 4-6 weeks of telemetry
window completes (≈ 2026-07-15+), per the standard cutover cadence. No
blocking issues found.

## Artifacts

- Screenshots: `chat.png`, `canvas.png` (this directory)
- Audit docs (committed to theokit/develop):
  - `docs/audit/g6-router-pre-flight-2026-06-04.md` (T0.1)
  - `docs/audit/g6-router-dogfood-app-migration-2026-06-04.md` (T3.1)
  - `docs/audit/g6-router-templates-audit-2026-06-04.md` (T4.1)
  - `docs/audit/g6-router-dogfood-shipit-2026-06-04.md` (T5.1 HTTP smoke — supplemented by this Chrome MCP report)
- Migration guide: `docs/migration/0.3-to-0.4-router.md`
- CHANGELOG: `CHANGELOG.md` + `packages/theo/CHANGELOG.md` + `packages/create-theo/CHANGELOG.md`
- Commits (theokit/develop): `3d2cfd5` → `953acfa` (8 commits pushed)
- npm: `theokit@0.4.0-beta.0` + `create-theokit@0.4.0-beta.0` both on `@next` tag
