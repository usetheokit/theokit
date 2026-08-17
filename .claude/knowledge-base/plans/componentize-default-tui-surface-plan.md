# Plan: Componentize the default template's TUI surface + ship its System Design

> **Version 1.0** — The scaffolded TUI surface's `tui/App.tsx.tmpl` grew to 460 lines at `create-theokit@1.22.0` after wiring the 11 `@theokit/tui@0.40.0` components live. This plan extracts the self-contained pieces — the welcome `Banner`, the `/usage` observability panel, and the `/plan /ask /select /progress` demo showcase — into a `tui/components/` folder, returning `App.tsx` to a focused agent-chat composition root, and ships a **System Design** section in `README-surface.md` so the scaffolded app carries its own architecture map. Behavior is preserved byte-for-byte (all 1.22.0 surfaces stay live); the split is proportionate to a scaffold (4 files, not one-per-line). Expected outcome: `App.tsx` ≤ 230 lines, each new component single-responsibility and deletable, the generated app still `tsc --noEmit` clean.

## Goal

> "Reduce the scaffolded `tui/App.tsx` from 460 to ≤ 230 lines by extracting `Banner`, `UsagePanel`, and the demo showcase into `tui/components/*`, measured by `scaffold-surface.test.ts` passing AND a scaffolded instance's `tsc --noEmit` exiting 0 with every 1.22.0 behavior preserved."

## Context

`create-theokit@1.22.0` (commit `e1b50461`) wired the full `@theokit/tui@0.40.0` set into the TUI surface, live in `App.tsx`: `Stack` layout, `PermissionPrompt` HITL, a `/usage` observability panel (`ContextWindowBar` + `TokenUsageChart` + `CostMeter` from real `lastUsage`), a `Toast`, and four interactive slash-command demos (`/plan` → `PlanApproval`, `/ask` → `QuestionPrompt`, `/select` → `SelectList`, `/progress` → `MultiStepProgress` + `ProgressActivity` + `ProgressBar`). The user chose "tudo dentro do App.tsx ao vivo" over a separate gallery, which was the right call for *reachability* but left one 460-line file mixing three concerns: the real agent chat, the demo showcase, and the observability panel. A new user opening `App.tsx` now has to scroll past ~200 lines of demo wiring to find the chat loop. Componentizing separates the concerns and makes the demos deletable in one place, without losing the "live in the app" property (they stay reachable from the composer).

The user also asked for a **System Design** for the `default` template's TUI surface — a shipped architecture map (component tree + data flow + layer boundaries + extension points).

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/create-theokit/templates/surfaces/tui/tui/App.tsx.tmpl` | 460 | `e1b50461` (2026-07-16) | The TUI surface entry: composition root + Banner + all 11 component wirings. Rendered to `tui/App.tsx` at scaffold time (`{{name}}` substituted, `.tmpl` stripped). | Every 1.22.0 behavior preserved: `Stack` root, greeting prepend, `AgentTimeline`, `AgentStreaming`, `PermissionPrompt` HITL (`decision === 'yes'`), `/usage` panel from real `lastUsage`, `Toast`, `/plan /ask /select /progress`, two-step Ctrl+C, Esc routing, `StatusFooter`. No new `ai` import. |
| `packages/create-theokit/templates/surfaces/tui/tui/components/Banner.tsx.tmpl` (NEW) | 0 | — | (file to be created) — the welcome banner extracted. | — |
| `packages/create-theokit/templates/surfaces/tui/tui/components/UsagePanel.tsx.tmpl` (NEW) | 0 | — | (file to be created) — the `/usage` observability panel, prop-driven. | — |
| `packages/create-theokit/templates/surfaces/tui/tui/components/Demos.tsx.tmpl` (NEW) | 0 | — | (file to be created) — the deletable demo showcase (`DemoSurface` + demo data + `Mode` type + self-contained `/progress` timer). | — |
| `packages/create-theokit/templates/surfaces/tui/README-surface.md.tmpl` | 26 | `79b7ed98` (2026-07-12) | The TUI surface's readme, rendered to `README-surface.md`. | Existing content kept; a `## Architecture` section is appended. |
| `packages/create-theokit/tests/unit/scaffold-surface.test.ts` | 272 | `e1b50461` (2026-07-16) | Asserts the scaffolded surface's file contents (string presence per file). | Existing web/desktop assertions untouched; the tui-app assertions move to the new files. |

### Current callers / dependents

- **Symbol:** `applySurface()` in `packages/create-theokit/src/scaffold-surface.ts:196`
  - Copies the fragment via `cpSync(src, targetDir, { recursive: true })` (line 205) then `substituteTmpls` (line 161, recursive walk) — so **new files under `tui/components/*.tmpl` are copied AND `{{name}}`-substituted automatically; no explicit file list to update.**
  - `tsconfigInclude` for the tui surface is `['tui/**/*.ts', 'tui/**/*.tsx', …]` (scaffold-surface.ts, tui SURFACE_CONFIG) — **already globs `tui/components/*.tsx`, so the new components are typechecked in the generated app with no scaffold-surface.ts change.**
  - **Callers (production):** the CLI entry `packages/create-theokit/src/cli.ts` (invokes `applySurface`). NOT changed by this plan.
  - **Callers (tests):** `packages/create-theokit/tests/unit/scaffold-surface.test.ts` scaffolds into a temp dir and reads files by relative path (`read('tui/App.tsx')`).
- **Symbol:** the `App` component in `tui/App.tsx.tmpl:185`
  - **Callers (production):** `tui/main.tsx.tmpl` (`render(<App/>, { exitOnCtrlC: false })`).
  - **External (published):** consumed only as generated scaffold output (`create-theokit` templates); no repo imports it.

### Domain glossary

- **surface fragment** — the per-surface template dir `templates/surfaces/<kind>/` copied onto the default at scaffold time (`applySurface`).
- **`.tmpl`** — a template file; `substituteTmpls` replaces `{{name}}` with the project name and strips the `.tmpl` extension recursively.
- **composition root** — the top-level component (`App`) that owns state + wiring and composes presentational children; the target shape for `App.tsx` post-split.
- **`useAgent().thread`** — the unified client store's committed conversation (M46); the single source the surface renders from.
- **`lastUsage`** — the last turn's `TurnUsage` (via `readTurnUsage`); drives the footer + the `/usage` panel.
- **`Mode`** — the composer mode (`chat|plan|ask|select|progress`); `chat` shows the composer, the others swap it for a demo surface.

### Architecture boundaries affected

- Entirely within the **`default` template's TUI surface** (`templates/surfaces/tui/`). No `packages/` runtime source changes → `sdk-runtime.md` / G1–G13 guardrails on `packages/**` are untouched (the template files are scaffold output, not framework source). The new `tui/components/` mirrors the existing `app/components` + `app/hooks` convention the default's web surface already uses (a precedent, not a new pattern). `shared/agent.ts` stays the single branding source; `Banner`/`App` import from it, never redefine it.

## Prior Art & Related Work

- **In-repo precedent — the default template already componentizes the web surface:** `templates/default/app/components` + `app/hooks` (confirmed via `find templates/default`). This plan applies the SAME "components folder" convention to the TUI surface, so the scaffold is internally consistent across surfaces.
- **In-repo — the recursive-copy contract:** `packages/create-theokit/src/scaffold-surface.ts:161,205` (`substituteTmpls` recursive + `cpSync recursive`) is the mechanism that makes adding `tui/components/*.tmpl` a no-op for the copier — cited as the reason no scaffold-surface.ts change is needed.
- **React composition (SRP)** — presentational children (`Banner`, `UsagePanel`) receive props/consts; the container (`App`) owns state. Standard container/presentational split; the `/progress` demo owns its own timer state so `App` never holds it (`react.dev` component-composition guidance).
- **Patterns skills:** the only `*-patterns` skill (`theokit-http-decorators-pattern-from-nestjs-patterns`) targets `@theokit/http-decorators` / `defineRoute` — no keyword overlap with a TUI scaffold componentization. Not applicable (no override ADR needed).

## Objective

- [ ] `Banner` extracted to `tui/components/Banner.tsx` (imports `shared/agent` + `theme`; no `App` state).
- [ ] `UsagePanel` extracted to `tui/components/UsagePanel.tsx` — prop-driven (`usage: TurnUsage`, `contextWindow: number`), builds the token-category map internally.
- [ ] Demo showcase extracted to `tui/components/Demos.tsx` — a `DemoSurface` component (switch on `Mode`) + demo data + `Mode` type + a self-contained `/progress` timer; `App` no longer holds `progressStep`.
- [ ] `App.tsx` becomes the composition root: `useAgent`, top-level state, `handleSubmit`, `useInput`, and a JSX tree composing the children. ≤ 230 lines.
- [ ] Every 1.22.0 behavior preserved (verified by a scaffolded-instance live smoke + `tsc --noEmit`).
- [ ] `README-surface.md` ships a `## Architecture` System Design section (component tree + data flow + layer boundaries + extension points + "delete the demos here").
- [ ] `scaffold-surface.test.ts` updated to the new file layout; `create-theokit` unit suite green.

## ADRs

### D1 — Split into four files under `tui/components/`, not one-per-component and not one-big-file

- **Decision:** `App.tsx` (composition root) + `components/Banner.tsx` + `components/UsagePanel.tsx` + `components/Demos.tsx`. Demo data + `Mode` type + the `/progress` timer live inside `Demos.tsx`.
- **Rationale:** Proportionate to a **scaffold** (KISS/YAGNI — `rules/parsimony-ladder.md`): three concerns (chat / observability / demos) → three presentational modules + one root. Each file is single-responsibility (SRP) and the whole demo showcase is deletable by removing one file + one JSX branch. Mirrors the default's existing `app/components` convention (DRY of structure).
- **Alternatives considered:**
  - *One file per demo* (`PlanDemo.tsx`, `AskDemo.tsx`, … + a `hooks/` dir) — rejected: 6+ files for a scaffold showcase is over-decomposition (YAGNI); more files to trace defeats "easy to read", and the demos share one `Mode` switch that would fragment.
  - *Extract only `Demos.tsx`, leave `Banner`/`UsagePanel` inline* — rejected: `App.tsx` would still be ~330 lines and mix presentation with the container; the Goal's ≤ 230 target would miss.
- **Consequences:** `App` imports three children; the demo showcase is quarantined in one file a user can delete wholesale. Slightly more files, but each is short and named for its job.

### D2 — The `/progress` demo owns its own timer state; `App` holds only `mode`

- **Decision:** Move `progressStep` + the advancing `useEffect` out of `App` into a `ProgressDemo` inside `Demos.tsx`; it calls `onComplete()` when the run finishes and `onToast()` for the outcome. `App` renders `<DemoSurface mode onComplete onToast />` and owns only the `mode` selector.
- **Rationale:** SRP + encapsulation — the timer is an implementation detail of the progress demo, not app-level state. Removes a `useEffect` + a `useState` from the container, shrinking `App` and making the demo self-contained (deletable without touching `App` state).
- **Alternatives considered:** *Keep `progressStep` in `App`, pass down* — rejected: leaks demo internals into the container; `App` would still carry the timer effect and its cleanup.
- **Consequences:** `Demos.tsx` owns a small amount of state; `App` stays a thin router. The `/progress` self-completion path (timer → `onComplete` → back to chat) is unchanged in behavior.

### D3 — Ship the System Design as a `## Architecture` section in `README-surface.md`, not a separate docs file

- **Decision:** Append the System Design (ASCII component tree + data-flow + layer boundaries + extension points) to the existing `README-surface.md.tmpl`.
- **Rationale:** KISS — the surface already ships a readme; one discoverable file beats a second `docs/architecture.md` a user might miss. The System Design lives next to the "how to run this surface" content it complements.
- **Alternatives considered:** *A dedicated `docs/tui-architecture.md` in the scaffold* — rejected for now: adds a file to every scaffold for a doc that fits a readme section; can be promoted later if the surface grows a full docs tree (noted in Unresolved Questions).
- **Consequences:** The scaffolded app carries its architecture map in its readme. Scope is the TUI surface; a broader default-template system design (web/server/agents) is deferred.

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| The template is NOT typechecked in the monorepo — a props/import mistake in the new files ships silently to users. | High | Mandatory gate: scaffold a real instance + `tsc --noEmit` exit 0 (Final Phase), exactly as the #136 + 1.22.0 flows did. Unit test asserts the new files exist + key symbols. | scaffold |
| Behavior regression during the extract (a swapped prop, a lost Esc branch, a broken `/progress` timer). | High | Live dogfood smoke in tmux of every surface (banner, `/usage`, `/plan/ask/select/progress`, HITL, Ctrl+C) before publish; the split is a pure move (no logic change). | scaffold |
| More files could make a *small* scaffold feel heavier to trace. | Low | Only 3 new short files, all under `tui/components/`, named for their job; the System Design doc maps them. Demos are one deletable file. | scaffold |
| `substituteTmpls` must reach the nested `tui/components/*.tmpl` — if it were non-recursive, `{{name}}` would leak. | Low | Verified recursive (`scaffold-surface.ts:161`); the unit test asserts no `{{name}}` remains in any scaffolded tui file. | scaffold |

## Unresolved Questions

- Q1 — Should the System Design cover the WHOLE default template (web surface + server + agents), or only the TUI surface being componentized? This plan scopes it to the TUI surface (the thing changing). A broader default-template design doc is a follow-up if desired.
- Q2 — Do `Banner`/`UsagePanel` belong in `tui/components/` or a shared `components/` reused across surfaces? Scoped to `tui/components/` here (they use `@theokit/tui`, tui-only); a cross-surface shared folder is out of scope (the web surface uses `@usetheo/ui`, not `@theokit/tui`).

## Dependency Graph

```
Phase 1 (extract components) ──▶ Phase 2 (System Design doc) ──▶ Phase 3 (tests + release plumbing) ──▶ Final Phase (scaffold + tsc + live smoke)
```

Phase 1 tasks (T1.1 Banner, T1.2 UsagePanel, T1.3 Demos, T1.4 slim App) are sequential on `App.tsx` (they all edit it), so they run in order. Phase 2 and Phase 3 depend on Phase 1 being complete.

---

## Phase 1: Extract the components

**Objective:** Move `Banner`, the `/usage` panel, and the demo showcase out of `App.tsx.tmpl` into `tui/components/*`, leaving `App.tsx` a composition root.

### T1.1 — Extract `Banner` to `tui/components/Banner.tsx`

#### Objective
Move the `Banner()` function (App.tsx.tmpl:124-184) to its own file; `App` imports it.

#### Why this step (action + reasoning — ReAct discipline)
1. **What this step does** — create `components/Banner.tsx.tmpl` with the banner JSX, importing `ACCENT`/`LOGO`/`BANNER_TIPS`/`BANNER_WHATS_NEW`/`WIDE_COLS` from `../theme.js`, `AGENT` from `../../shared/agent.js` (for the model label), and carrying `APP_NAME = '{{name}}'`; delete the function from `App.tsx.tmpl` and import it.
2. **Why it is necessary now** — the banner is a self-contained presentational block with no `App` state (Baseline Context: it reads only module consts). It is the cleanest first extraction and immediately removes ~60 lines from `App.tsx`. Per D1, presentational children live in `tui/components/`.

#### Evidence
- `App.tsx.tmpl:124-184` — `function Banner()` reads `ACCENT`, `LOGO`, `BANNER_TIPS`, `BANNER_WHATS_NEW`, `WIDE_COLS`, `APP_NAME`, `MODEL`, `CWD`. No `App` state referenced.
- `scaffold-surface.ts:161` — `substituteTmpls` recurses, so `{{name}}` inside `components/Banner.tsx.tmpl` is substituted.

#### Files to edit
```
packages/create-theokit/templates/surfaces/tui/tui/components/Banner.tsx.tmpl — (NEW) the extracted banner
packages/create-theokit/templates/surfaces/tui/tui/App.tsx.tmpl — remove Banner(), import it from './components/Banner.js'
```

#### Deep file dependency analysis
- `App.tsx.tmpl` (Baseline row 1): the `Banner()` function is removed; `<Banner />` in the return stays. `MODEL`/`CWD` consts move to Banner.tsx (only Banner uses `CWD`; `MODEL` is also used by the footer in App → keep `MODEL` in App, pass nothing — Banner recomputes `AGENT.model` locally OR imports it. Decision: Banner imports `AGENT` + computes its own label; App keeps its `MODEL` for the footer. DRY is not violated — both read the same `AGENT.model` source).
- New `Banner.tsx.tmpl` imports `ink` (`Box`, `Text`), `react` (`ReactElement`), `../theme.js`, `../../shared/agent.js`.

#### Deep Dives
- **Invariant:** the two-column responsive layout (`cols >= WIDE_COLS`) and fixed left column `width={38}` (cwd truncation) are preserved verbatim.
- **Edge case:** `APP_NAME = '{{name}}'` must be inside `Banner.tsx.tmpl` so `substituteTmpls` replaces it — verified recursive.

#### Pseudo-code / Signatures
```pseudocode
// components/Banner.tsx.tmpl
export function Banner(): ReactElement  // no props; reads theme consts + AGENT + process.stdout.columns
```

#### Tasks
1. Create `components/Banner.tsx.tmpl` with the moved function + its imports + `APP_NAME`/`CWD`.
2. In `App.tsx.tmpl`: delete `function Banner()`, add `import { Banner } from './components/Banner.js'`, drop now-unused `CWD`.

#### TDD
```
RED:     test asserts scaffolded `tui/components/Banner.tsx` exists AND contains '✻ Welcome to' AND '{LOGO}' [scaffold-surface.test.ts]
RED:     test asserts scaffolded `tui/App.tsx` imports "./components/Banner.js" AND no longer defines "function Banner"
GREEN:   create Banner.tsx.tmpl + edit App.tsx.tmpl
REFACTOR: None expected.
VERIFY:  pnpm --filter create-theokit test
```

#### Concurrency tests (only when applicable)

(none — single-threaded)

#### Acceptance Criteria
- [ ] `tui/components/Banner.tsx` exists in the scaffold and renders the two-column banner.
- [ ] `App.tsx` imports `Banner` and no longer defines it.
- [ ] Pass: size — `Banner.tsx.tmpl` ≤ 100 lines; `App.tsx.tmpl` shrinks by ~60.
- [ ] Pass: lint — `eslint` clean on changed files (checked at Final Phase on a scaffolded instance).

#### DoD (Definition of Done)
- [ ] `pnpm --filter create-theokit test` green.
- [ ] No `{{name}}` leak (asserted by the suite).

### T1.2 — Extract the `/usage` panel to `tui/components/UsagePanel.tsx`

#### Objective
Move the observability panel (ContextWindowBar + TokenUsageChart + CostMeter) into a prop-driven `UsagePanel`.

#### Why this step (action + reasoning — ReAct discipline)
1. **What this step does** — create `UsagePanel.tsx.tmpl` exporting `UsagePanel({ usage, contextWindow })`; it builds the token-category map (only present categories) and renders the three components. `App` renders `{showUsage && lastUsage ? <UsagePanel usage={lastUsage} contextWindow={AGENT.contextWindow} /> : null}` and drops the inline `usageChart` const + the inline block.
2. **Why it is necessary now** — the panel is a pure function of `lastUsage`; extracting it removes the `usageChart` computation and a JSX block from `App` (SRP). Prop-driven so it is trivially reusable/testable (Baseline Context: `usageChart` built from `TurnUsage` fields).

#### Evidence
- `App.tsx.tmpl` — the `usageChart` const (built from `input/output/cacheReadTokens/reasoningTokens`) + the `{showUsage && lastUsage ? (<Box>…ContextWindowBar…TokenUsageChart…CostMeter…</Box>) : null}` block.
- `@theokit/tui@0.40.0` types: `TokenUsageChart usage: Partial<Record<TokenCategory,number>>`; `TOKEN_CATEGORIES=[input,output,cached,reasoning]`.

#### Files to edit
```
packages/create-theokit/templates/surfaces/tui/tui/components/UsagePanel.tsx.tmpl — (NEW) prop-driven panel
packages/create-theokit/templates/surfaces/tui/tui/App.tsx.tmpl — replace the inline panel + usageChart with <UsagePanel/>
```

#### Deep file dependency analysis
- `App.tsx.tmpl`: removes `usageChart` + the panel block; keeps `showUsage` state + `lastUsage`. Imports `UsagePanel`.
- `UsagePanel.tsx.tmpl` imports `ContextWindowBar`, `TokenUsageChart`, `CostMeter`, `type TurnUsage`, `type TokenCategory` from `@theokit/tui`, `Box` from `ink`.

#### Deep Dives
- **Data structure:** `usage: TurnUsage` (has `inputTokens`, `outputTokens`, optional `cacheReadTokens`, `reasoningTokens`, `cost`). Build `usageChart` only from present categories; render `CostMeter` only when `usage.cost !== undefined`.
- **Invariant:** identical render to 1.22.0 (`99% left (used/limit)`, four category rows, cost when reported).

#### Pseudo-code / Signatures
```pseudocode
// components/UsagePanel.tsx.tmpl
export function UsagePanel({ usage, contextWindow }: { usage: TurnUsage; contextWindow: number }): ReactElement
```

#### Tasks
1. Create `UsagePanel.tsx.tmpl`.
2. Edit `App.tsx.tmpl` to render `<UsagePanel/>` and drop the inline block + `usageChart`.

#### TDD
```
RED:     test asserts scaffolded `tui/components/UsagePanel.tsx` exists AND contains 'ContextWindowBar' AND 'TokenUsageChart' AND 'CostMeter'
RED:     test asserts `tui/App.tsx` contains '<UsagePanel' AND 'usedTokens' NO LONGER appears in App.tsx (moved)
GREEN:   create UsagePanel.tsx.tmpl + edit App.tsx.tmpl
REFACTOR: None expected.
VERIFY:  pnpm --filter create-theokit test
```

#### Concurrency tests (only when applicable)

(none — single-threaded)

#### Acceptance Criteria
- [ ] `UsagePanel` renders the three observability components from a `TurnUsage` prop.
- [ ] `App.tsx` no longer computes `usageChart` inline.
- [ ] Pass: size — `UsagePanel.tsx.tmpl` ≤ 60 lines.

#### DoD (Definition of Done)
- [ ] `pnpm --filter create-theokit test` green.

### T1.3 — Extract the demo showcase to `tui/components/Demos.tsx`

#### Objective
Move the four interactive demos + demo data + `Mode` type + the `/progress` timer into a single `DemoSurface` component.

#### Why this step (action + reasoning — ReAct discipline)
1. **What this step does** — create `Demos.tsx.tmpl` exporting `type Mode`, `DEMO_*` data, and `DemoSurface({ mode, onComplete, onToast })` that switches on `mode` to render `PlanApproval` / `QuestionPrompt` / `SelectList` / (`MultiStepProgress`+`ProgressActivity`+`ProgressBar`). The progress timer (`progressStep` + `useEffect`) lives INSIDE a `ProgressDemo` sub-component (D2). `App` renders `<DemoSurface mode={mode} onComplete={() => setMode('chat')} onToast={setToast} />` and drops `progressStep`, its `useEffect`, the `DEMO_*` consts, and the demo JSX branches.
2. **Why it is necessary now** — the demos are the bulk (~180 lines) and the one deletable concern (per the user's "deletable in one place"). Encapsulating the timer (D2) removes app-level state. This is the change that most shrinks `App` and quarantines the showcase.

#### Evidence
- `App.tsx.tmpl:73-100` (`DEMO_*` + `Mode`), `:199-200` (`mode`/`progressStep` state), `:238-` (`useEffect` timer), and the `mode === 'plan' ? … : mode === 'ask' ? …` render ladder.
- `@theokit/tui@0.40.0` types: `PlanDecision`, `QuestionAnswer`, `SelectListItem`, `TodoItem`.

#### Files to edit
```
packages/create-theokit/templates/surfaces/tui/tui/components/Demos.tsx.tmpl — (NEW) DemoSurface + data + Mode + ProgressDemo (owns timer)
packages/create-theokit/templates/surfaces/tui/tui/App.tsx.tmpl — render <DemoSurface/>; import Mode; drop progressStep/useEffect/DEMO_*/demo branches
```

#### Deep file dependency analysis
- `App.tsx.tmpl`: removes `progressStep` state, the progress `useEffect`, `DEMO_*` consts, and the four demo JSX branches (kept: `pendingApproval` PermissionPrompt branch + `ChatComposer` branch). Imports `type Mode` + `DemoSurface`. `handleSubmit`'s `/plan /ask /select /progress` cases keep setting `mode` (the mode selector stays in `App`; the surface rendering moves to `Demos`).
- `Demos.tsx.tmpl` imports the demo components + types from `@theokit/tui`, `ink`, `react` (`useState`/`useEffect` for `ProgressDemo`).

#### Deep Dives
- **State ownership (D2):** `App` owns `mode`; `ProgressDemo` owns `progressStep` + the timer, calls `onComplete()` at the end. The `useInput` guard `inDemoInput = mode === 'plan' || 'ask' || 'select'` STAYS in `App` (it gates App-level keys while a demo owns input); the progress Esc→chat also stays in `App`'s `useInput` (App owns `setMode`).
- **Invariant:** identical behavior — `/plan` approve → `onToast('Plan approved')` + back to chat; `/progress` advances 700ms/step, self-completes → `onToast('Task complete')`.
- **Edge case:** when `mode==='progress'`, the demo mounts fresh each time (`key`?) so the timer restarts from 0 — ensure `ProgressDemo` resets `progressStep` on mount (it's local state, starts at 0 by default).

#### Pseudo-code / Signatures
```pseudocode
// components/Demos.tsx.tmpl
export type Mode = 'chat' | 'plan' | 'ask' | 'select' | 'progress'
export function DemoSurface({ mode, onComplete, onToast }: {
  mode: Exclude<Mode, 'chat'>
  onComplete: () => void
  onToast: (t: { message: string; variant: 'info' | 'success' | 'error' }) => void
}): ReactElement | null
// internal: ProgressDemo owns progressStep + the 700ms timer, calls onComplete when done
```

#### Tasks
1. Create `Demos.tsx.tmpl` with `Mode`, `DEMO_*`, `DemoSurface`, and internal `ProgressDemo`.
2. Edit `App.tsx.tmpl`: import `Mode` + `DemoSurface`; render `<DemoSurface/>` for non-chat/non-approval modes; delete moved consts/state/effect/branches.

#### TDD
```
RED:     test asserts scaffolded `tui/components/Demos.tsx` exists AND contains 'PlanApproval' AND 'QuestionPrompt' AND 'SelectList' AND 'MultiStepProgress' AND 'ProgressActivity' AND 'ProgressBar'
RED:     test asserts `tui/App.tsx` contains '<DemoSurface' AND "name: 'progress'" (composer palette) AND no longer contains 'PlanApproval' (moved out)
GREEN:   create Demos.tsx.tmpl + edit App.tsx.tmpl
REFACTOR: None expected.
VERIFY:  pnpm --filter create-theokit test
```

#### Concurrency tests (only when applicable)

(none — single-threaded)

The `/progress` `setTimeout` is a single-threaded UI timer, not shared-state concurrency — the same posture as the 1.22.0 original.

#### Acceptance Criteria
- [ ] `Demos.tsx` holds all four demos + data + the progress timer.
- [ ] `App.tsx` renders `<DemoSurface/>` and holds no `progressStep`.
- [ ] Pass: size — `Demos.tsx.tmpl` ≤ 220 lines.

#### DoD (Definition of Done)
- [ ] `pnpm --filter create-theokit test` green.

### T1.4 — Reduce `App.tsx` to a composition root ≤ 230 lines

#### Objective
Confirm `App.tsx.tmpl` is now the composition root (state + `handleSubmit` + `useInput` + JSX tree composing children) and ≤ 230 lines.

#### Why this step (action + reasoning — ReAct discipline)
1. **What this step does** — after T1.1–T1.3, tidy `App.tsx.tmpl` imports (drop now-unused `@theokit/tui` symbols moved to children — `ContextWindowBar`, `CostMeter`, `TokenUsageChart`, `PlanApproval`, `QuestionPrompt`, `SelectList`, `MultiStepProgress`, `ProgressActivity`, `ProgressBar`, `type SelectListItem`, `type TodoItem`, `type TokenCategory`; keep `Stack`, `AgentTimeline`, `AgentStreaming`, `ChatComposer`, `PermissionPrompt`, `Notice`, `StatusFooter`, `Toast`, `KeyboardHelp`, `InkInputProvider`, `findPendingApproval`, `readTurnUsage`, `messagesToAgentEvents`, `useTurnElapsed`, `TheoTUIProvider`, `type UIMessageLike`), and verify the line count.
2. **Why it is necessary now** — the extractions leave dead imports; a lingering unused import is an eslint error in the generated app. This task closes the Goal's line-count metric and import hygiene.

#### Evidence
- The Goal metric: `App.tsx` 460 → ≤ 230.
- eslint (in the scaffolded app, run at Final Phase) fails on unused imports.

#### Files to edit
```
packages/create-theokit/templates/surfaces/tui/tui/App.tsx.tmpl — prune imports, final line-count check
```

#### Deep file dependency analysis
- Only import lines + whitespace change; the composition tree (Banner/Timeline/Streaming/UsagePanel/Toast/Help/mode-switch/Footer) already references the children after T1.1–T1.3.

#### Deep Dives
- **Invariant:** `App` still owns `useAgent`, `showHelp`/`exitArmed`/`settledApprovals`/`mode`/`showUsage`/`toast` state, `settleApproval`, `handleSubmit`, `useInput` (including `inDemoInput` guard + progress Esc), and the JSX tree.

#### Tasks
1. Remove imports now only used by children.
2. `wc -l` confirms ≤ 230.

#### TDD
```
RED:     test asserts `wc -l tui/App.tsx` ≤ 230 in the scaffolded app (or assert absence of the moved symbols' imports in App.tsx)
GREEN:   prune imports
REFACTOR: None expected.
VERIFY:  pnpm --filter create-theokit test
```

#### Concurrency tests (only when applicable)

(none — single-threaded)

#### Acceptance Criteria
- [ ] `tui/App.tsx` ≤ 230 lines in the scaffold.
- [ ] No import of `ContextWindowBar`/`PlanApproval`/… remains in `App.tsx`.
- [ ] Pass: lint — no unused imports (Final Phase, scaffolded instance).

#### DoD (Definition of Done)
- [ ] `pnpm --filter create-theokit test` green.

---

## Phase 2: Ship the System Design

**Objective:** Give the scaffolded app an architecture map.

### T2.1 — Append the `## Architecture` System Design to `README-surface.md`

#### Objective
Document the TUI surface's component tree, data flow, layer boundaries, and extension points.

#### Why this step (action + reasoning — ReAct discipline)
1. **What this step does** — add a `## Architecture` section to `README-surface.md.tmpl` with: an ASCII component tree (`App` → `Banner` / `AgentTimeline` / `UsagePanel` / `DemoSurface` / `ChatComposer` / `StatusFooter`), the data flow (`useAgent → thread → messagesToAgentEvents → AgentTimeline`; `readTurnUsage → lastUsage → UsagePanel`/footer), the layer boundaries (`shared/agent.ts` branding → all layers; `agents/chat.ts` persona; `server` runtime; `tui/` surface), and extension points (`theme.ts` restyle, `shared/agent.ts` branding, delete `components/Demos.tsx` to drop the showcase).
2. **Why it is necessary now** — per D3, the scaffold should carry its own map so a new user understands the surface without reading every file; the componentization makes the tree worth documenting.

#### Evidence
- `README-surface.md.tmpl:1-26` (existing content to append to).
- The new component tree from Phase 1.

#### Files to edit
```
packages/create-theokit/templates/surfaces/tui/README-surface.md.tmpl — append ## Architecture
```

#### Deep file dependency analysis
- Doc-only; no code dependency. Rendered to `README-surface.md` at scaffold time (no `{{name}}` needed unless referencing the app name — optional).

#### Deep Dives
- **Content:** component tree + data-flow arrows + layer table + "extension points" list + "delete the demos: remove `tui/components/Demos.tsx` and the `<DemoSurface/>` branch in `App.tsx`".

#### Tasks
1. Append the `## Architecture` section.

#### TDD
```
RED:     test asserts scaffolded `README-surface.md` contains '## Architecture' AND 'components/Demos' AND 'useAgent'
GREEN:   append the section
REFACTOR: None expected.
VERIFY:  pnpm --filter create-theokit test
```

#### Concurrency tests (only when applicable)

(none — single-threaded)

#### Acceptance Criteria
- [ ] `README-surface.md` has an `## Architecture` section with the component tree + data flow + extension points.

#### DoD (Definition of Done)
- [ ] `pnpm --filter create-theokit test` green.

---

## Phase 3: Tests + release plumbing

**Objective:** Lock the new layout in the unit suite and prepare the release.

### T3.1 — Update `scaffold-surface.test.ts` + changeset

#### Objective
Point the tui-app assertions at the new files and add a minor changeset.

#### Why this step (action + reasoning — ReAct discipline)
1. **What this step does** — move the moved-symbol assertions (`Banner`, `ContextWindowBar`, `PlanApproval`, …) from the `tui/App.tsx` read to reads of `tui/components/Banner.tsx` / `UsagePanel.tsx` / `Demos.tsx`; keep App-level assertions (`PermissionPrompt` usage, `StatusFooter`, `findPendingApproval`, `<DemoSurface`). Add `.changeset/*.md` (minor, `create-theokit`).
2. **Why it is necessary now** — the string-presence assertions currently target `App.tsx`; after the move they must target the new files or they false-fail/false-pass. The changeset drives the publish (Unbreakable Rule 6).

#### Evidence
- `scaffold-surface.test.ts:113-137` — the tui-app component assertions.

#### Files to edit
```
packages/create-theokit/tests/unit/scaffold-surface.test.ts — retarget assertions to new files; assert new files exist
.changeset/componentize-tui-surface.md — (NEW) minor bump create-theokit
```

#### Deep file dependency analysis
- Test reads scaffolded files by relative path; add `read('tui/components/Banner.tsx')` etc.

#### Deep Dives
- **Invariant:** web + desktop surface assertions untouched; only the tui-app block changes.

#### Tasks
1. Retarget the assertions.
2. Write the changeset.

#### TDD
```
RED:     the retargeted assertions fail against the OLD monolithic App (proves they now bind to the new files)
GREEN:   (already produced by Phase 1) — assertions pass against the new layout
REFACTOR: None expected.
VERIFY:  pnpm --filter create-theokit test
```

#### Concurrency tests (only when applicable)

(none — single-threaded)

#### Acceptance Criteria
- [ ] Assertions target the new component files.
- [ ] Changeset present (minor, `create-theokit`).

#### DoD (Definition of Done)
- [ ] `pnpm --filter create-theokit test` green.
- [ ] `pnpm changeset status` recognizes the pending changeset.

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | `App.tsx` monolith (460 lines) mixes chat + demos + observability | T1.1–T1.4 | Extract to `components/*`; App ≤ 230. |
| 2 | Banner is inline | T1.1 | `components/Banner.tsx`. |
| 3 | `/usage` panel inline | T1.2 | `components/UsagePanel.tsx` (prop-driven). |
| 4 | Demos not deletable in one place | T1.3 | `components/Demos.tsx` (one file, one JSX branch). |
| 5 | Demo timer is app-level state | T1.3 (D2) | `ProgressDemo` owns `progressStep`. |
| 6 | No shipped System Design for the surface | T2.1 (D3) | `## Architecture` in `README-surface.md`. |
| 7 | Test assertions target the monolith | T3.1 | Retargeted to new files. |
| 8 | Behavior must be preserved | T1.1, T1.2, T1.3, T1.4 | Pure code-moves (no logic change) across T1.1–T1.4; validated by the Final Phase scaffold + `tsc` + live smoke. |
| 9 | Ship it | T3.1 + Final Phase | changeset (minor) + publish flow. |

**Coverage: 9/9 gaps covered (100%)**

## Global Definition of Done

- [ ] All phases completed.
- [ ] All tests passing — `pnpm --filter create-theokit test` green.
- [ ] Zero type errors — a scaffolded instance's `tsc --noEmit` exits 0 (template is NOT typechecked in the monorepo — MUST scaffold a real instance).
- [ ] Zero lint warnings — `eslint` clean on the scaffolded instance's `tui/**`.
- [ ] File-size budget respected — `App.tsx.tmpl` ≤ 230; each new component ≤ its stated cap; all < 500.
- [ ] CHANGELOG / changeset updated (Unbreakable Rule 6) — minor `create-theokit`.
- [ ] Backward compatibility — every 1.22.0 behavior preserved (live-smoked).
- [ ] Plan-specific — `wc -l tui/App.tsx` ≤ 230 in the scaffold; `components/{Banner,UsagePanel,Demos}.tsx` exist and typecheck.
- [ ] Plan archived after `/review` READY_TO_MERGE + PR/publish.

## Failure scenarios (when I/O external)

(none — no external I/O touched; this is a pure code-move + a doc + a test retarget. The `/progress` `setTimeout` is a local UI timer, not external I/O.)

## Final Phase: Integration Validation (MANDATORY)

**Objective:** Prove the componentized surface scaffolds, typechecks, and behaves exactly like 1.22.0.

### Execution
```
pnpm --filter create-theokit build            # rebuild the CLI
pnpm --filter create-theokit test             # unit suite (new file assertions)
# scaffold a REAL instance from the local build (the template is NOT typechecked in the monorepo):
node packages/create-theokit/dist/cli.js my-app-cz --surface tui --yes   # into a scratch dir
cd my-app-cz && npx tsc --noEmit              # MUST exit 0
npx eslint tui/**/*.tsx --max-warnings=0      # MUST be clean
# live smoke in tmux: boot `npm run dev`, exercise banner, /usage (after a real turn), /plan, /ask,
# /select, /progress, the send_notification HITL PermissionPrompt, /help, two-step Ctrl+C, Esc.
```

### Acceptance Criteria
- [ ] `pnpm --filter create-theokit test` green.
- [ ] Scaffolded `tsc --noEmit` exits 0.
- [ ] Scaffolded `eslint tui/**` clean (no unused imports post-extraction).
- [ ] `wc -l tui/App.tsx` ≤ 230.
- [ ] Live smoke: every 1.22.0 surface renders/behaves identically (banner, `/usage` real data, 4 demos, HITL, Ctrl+C, Esc).

### If Validation Fails
1. Separate plan-caused failures from pre-existing.
2. Fix plan-caused failures before declaring complete.
3. Re-run the chain.
4. Log pre-existing issues in the PR/release description.
