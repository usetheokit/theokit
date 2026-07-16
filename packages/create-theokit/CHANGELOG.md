# create-theo

## 1.22.0

### Minor Changes

- TUI surface wires the full `@theokit/tui@0.40.0` component set live into the scaffolded app — each with a real hook, not a static gallery. `Stack` lays out the app with the Claude-Code one-line cadence. `/usage` toggles an observability panel built from the last turn's real usage: `ContextWindowBar` (context fill), `TokenUsageChart` (input/output/cached/reasoning breakdown), and `CostMeter` (session cost, when reported). A `Toast` surfaces transient outcomes (a demo answered, a task finished; auto-dismiss). Four slash-command demos run interactively from the composer: `/plan` → `PlanApproval` (approve/revise a markdown plan), `/ask` → `QuestionPrompt` (options + free-text), `/select` → `SelectList` (multi-select), `/progress` → `MultiStepProgress` + `ProgressActivity` + `ProgressBar` (timer-advanced multi-step task). Every surface is deletable from the one file. Live-verified end-to-end in a real terminal; the generated app typechecks against the 0.40.0 types.

## 1.21.0

### Minor Changes

- TUI surface adopts `@theokit/tui@^0.40.0` and upgrades the human-in-the-loop gate to the Claude-Code `PermissionPrompt` card. A gated tool now renders a structured approval card — tool-type header, the command on its own line, the proposed input as a description, `Do you want to proceed?`, and a numbered `1. Yes / 2. No` menu (↑/↓ + Enter, Esc → the safe `No` default) — replacing the previous `once/always/reject` `ApprovalPrompt` bar. The `onDecision` maps `yes` → approve. Live-verified end-to-end: a real model turn calls `send_notification`, the card renders, `Yes` approves, and the tool executes.

## 1.20.1

### Patch Changes

- TUI: monochrome-by-default chrome — color is now reserved for meaning. The assistant `⏺` bullet, the `>` prompt, and the input border render in the terminal's default color (via `tui/theme.ts`: `accent: ''` + neutral `role.*.prefix`), while semantic colors are kept: tool states (pending gray · running yellow · success green · failed red) and errors (red). The welcome banner keeps its accent (it uses the `ACCENT` const directly). Restyle in one line — set `accent: ACCENT` to colorize the chrome, or tint the bullets via `role.*.prefix`.

## 1.20.0

### Minor Changes

- TUI: a `npm run demo:tools` script (and `tui/tool-variations.tsx`) that renders a visual reference of every way the timeline draws a tool — pending, running, success, a shell-envelope output, failed, and approval-requested — plus an assistant markdown turn and a thinking row. It feeds a synthetic conversation through the SAME `messagesToAgentEvents` → `<AgentTimeline>` path the real app uses and reads your `tui/theme.ts`, so it's an accurate, agent-free way to preview your colors/glyphs and see each tool state. Delete the file if you don't want it.

## 1.19.0

### Minor Changes

- TUI: a single **`tui/theme.ts`** file to restyle the whole terminal UI. All the visual knobs — the accent color, the global `@theokit/tui` theme (with commented bullet-glyph override examples), the welcome-banner wordmark (`LOGO`), the tips + what's-new copy, the thinking-spinner words, and the input placeholder — now live in one well-documented file. `tui/App.tsx` imports from it and never needs touching for a rebrand: change the accent, swap the ASCII wordmark (`npx figlet -f "ANSI Shadow" "YourApp"`), edit the copy — done. Verified live: editing only `tui/theme.ts` re-themes the banner (accent + copy) on the next launch.

## 1.18.0

### Minor Changes

- TUI adopts `@theokit/tui@0.37.0`, closing the last two Claude-Code parity gaps (issues #44 + #45):

  - **Two-line footer** — the single-line status bar is replaced by `<StatusFooter>`: a top row with the model on the left and the context usage (`506/128k context`) justified to the right edge, and a bottom `? for shortcuts` row (the shortcuts move here from under the input box — the Claude Code layout).
  - **Thinking spinner: sparkle + token direction** — the spinner is now a cycling `✵`/`✳` sparkle (was a braille spinner) and the token count carries a `↓` arrow: `✵  Thinking (1s · ↓ 543 tokens · esc to interrupt)` — the exact Claude Code streaming line.

  Bumps `@theokit/tui ^0.36.0 → ^0.37.0`. Live-verified end-to-end against a real model turn.

## 1.17.2

### Patch Changes

- TUI: add a one-line top margin above the input composer (and the approval prompt that replaces it), so it no longer sits flush against the last message — a bit more breathing room between the conversation and where you type.

## 1.17.1

### Patch Changes

- TUI welcome banner refinements: it now spans the **full terminal width** with a one-cell margin on every side and inner padding; the mascot is replaced by a bold **"Theo"** wordmark (block letters) in the coral accent; and the layout has more breathing room between the logo, the `✻ Welcome` line, and the tips/what's-new columns. A fixed-width left column keeps the two-column layout intact even when the cwd is long (it truncates instead of pushing the right column off-screen).

## 1.17.0

### Minor Changes

- TUI surface: a Claude-Code-shaped welcome banner. On a wide terminal the scaffold now opens with a
  two-column box — LEFT: the `✻ Welcome to <app>` header, a little pixel mascot, the model, and the cwd
  (home tildeified); RIGHT: a `Tips for getting started` column and a `What's new` column — in Claude
  Code's warm coral border. It collapses to a single column (header + mascot + model + cwd) on narrow
  terminals so nothing truncates. Built as a small custom `<Box>` banner because `@theokit/tui`'s
  `WelcomeBanner` caps its width at 60 cols, too narrow for the two-column layout. Live-verified in a real
  terminal. No new deps.

## 1.16.1

### Patch Changes

- TUI surface adopts `@theokit/tui@0.36.0` for the last mile of Claude-Code parity:

  - **Thinking spinner shows the live token count + "esc to interrupt"** — the streaming hint is now the exact Claude Code shape `(Ns · N tokens · esc to interrupt)` (the scaffold passes the last turn's `totalTokens`), replacing the earlier `esc to cancel` with no count.
  - **Tighter assistant/tool alignment** — the `⏺` bullet's two-space gap now aligns assistant message rows with tool rows (from the theme), and `<AgentTimeline>` spacing between blocks reads cleaner.
  - **Errors render as a `<Notice variant="error">`** (`✗` marker) instead of a raw red line.

  Bumps `@theokit/tui ^0.35.0 → ^0.36.0`. Live-verified against a real model turn (`⠼  Thinking (1s · 510 tokens · esc to interrupt)`).

## 1.16.0

### Minor Changes

- TUI surface: a much closer Claude-Code look & feel out of the box.

  - **Welcome banner** — `✻ Welcome to <app>` in Claude Code's warm accent, with a `/help for help · /clear to reset` tips line and the cwd, in a rounded box (via `@theokit/tui`'s `WelcomeBanner`).
  - **Warm accent** — the theme accent is now Claude Code's coral `#d97757` (truecolor, degrades gracefully) instead of cyan: it colors the `✻`, the `⏺` assistant/tool markers, the box borders and the `>` prompt.
  - **Thinking spinner with personality** — while the agent streams, the spinner cycles whimsical status words (`Thinking · Pondering · Noodling · Percolating · Baking · Brewing · Simmering · Conjuring · Musing · Marinating`) and shimmers, with the elapsed seconds + `esc` hint (via `AgentStreaming`'s `phrases` + `shimmer`).
  - **Cleaner input** — a minimal `? for shortcuts` hint under the composer (the full keybinding list lives in the `?` panel), and an `Ask <app> anything…` placeholder.

  Live-verified in a real terminal against a real model turn. No new deps.

## 1.15.1

### Patch Changes

- TUI surface adopts `@theokit/tui@0.35.0`, which closes the two gaps the previous scaffold worked around:

  - **Claude-Code bullet glyph `⏺`** restored in the theme (issue #40) — the assistant/tool marker now matches Claude Code exactly, with no scaffold change (it comes from the theme).
  - **Real `<ApprovalPrompt>` choice bar** for HITL (issue #41). The scaffolded `tui/App.tsx` now wraps its tree in `<InkInputProvider>` (bridges Ink's stdin to the library's interactive surfaces) and renders `@theokit/tui`'s `<ApprovalPrompt>` — an `Allow once / Allow always / Reject` choice bar navigable with ←/→ + Enter — in place of the earlier Ink-native `[y]/[n]` prompt. Maps the choice to `agent.approve(approvalId, { approved: decision !== 'reject' })` and remembers settled ids so the standalone gate part stops re-showing. Live-verified end-to-end against a real model turn: navigate → commit → the gated tool runs → the agent continues → the prompt clears.

  Bumps `@theokit/tui ^0.34.0 → ^0.35.0`.

## 1.15.0

### Minor Changes

- TUI surface: **human-in-the-loop approval** for gated tools. The default agent now ships a demo
  side-effecting tool (`send_notification`) gated via `.approval('send_notification', …)`; ask the agent to
  "notify me that …" and the run pauses. The scaffolded `tui/App.tsx` surfaces the pending gate with
  `@theokit/tui`'s new `findPendingApproval(agent.thread)` and shows an approval prompt in place of the
  composer — `[y] allow · [n] reject` — settling it via `agent.approve(approvalId, { approved })`, then
  clearing once answered. The whole gate is real: the SDK genuinely parks the tool until you decide, the
  tool runs on approve and is skipped on reject. Live-verified end-to-end against a real model turn. Bumps
  `@theokit/tui ^0.33.0 → ^0.34.0` (adds `findPendingApproval` + `PendingApproval`). (The prompt is
  Ink-native — `@theokit/tui`'s `ApprovalPrompt` component targets its own renderer's input system, which
  the plain-Ink scaffold does not run.)

## 1.14.1

### Patch Changes

- Bump the default template's pins to the releases that carry the per-turn usage metadata the TUI footer reads end-to-end: `theokit ^0.43.0 → ^0.43.1` and `@theokit/agents ^0.42.0 → ^0.43.0`. Without this, a fresh scaffold installed `@theokit/agents@0.42.x` whose stream did not ride usage on the finish chunk, so the footer's tokens/cost stayed blank against a real model turn. Now the whole chain — translator emits `messageMetadata` → `readUIMessageStream` lands it on `UIMessage.metadata` → `readTurnUsage` → `AppStatusBar` — ships from published bits.

## 1.14.0

### Minor Changes

- TUI surface: Claude-Code interaction parity in the scaffolded `tui/App.tsx`. The composer already carried the primitives from `@theokit/tui`; the app now wires the full set:

  - **Keyboard-help panel** — `?` on an empty line (or `/help`) toggles a `KeyboardHelp` overlay listing every shortcut (`DEFAULT_COMPOSER_SHORTCUTS`).
  - **Ctrl+C two-step quit** — a single press cancels a running turn or arms the exit (`Press Ctrl+C again to quit`); a second press quits. `tui/main.tsx` now renders with `exitOnCtrlC: false` so the app owns the key.
  - **Slash-command palette** — `/clear` and `/help` in a prefix-filtered menu (typing `/` opens it; ↑↓ select, Tab/Enter complete).
  - **@-file mentions + ↑↓ history** — already on by default from `ChatComposer` (gitignore-aware cwd walk + input recall), now surfaced in the placeholder/help.

  Live-verified in a real terminal: the help panel toggles, Esc dismisses it, and the two-step Ctrl+C quit arms then exits.

## 1.13.0

### Minor Changes

- TUI surface: the status-bar footer now shows **real tokens and cost**, not just `model · cwd`. Bumped `@theokit/tui ^0.32.0 → ^0.33.0` and wired the scaffolded `tui/App.tsx` to read each turn's usage off `useAgent().thread` (via `readTurnUsage`) — rendering the current turn's context tokens against the model's window (`12.3k/128k`) plus the summed session cost (`cost ~$0.01`). The window denominator is a new `AGENT.contextWindow` field in `shared/agent.ts` (a model property you set when you change models — 128k for gpt-4o-mini). The footer is now `model · cwd · tokens · cost · state`, the Claude-Code shape. Requires `@theokit/tui ^0.33.0`.

## 1.12.0

### Minor Changes

- Scaffolds now work + look right on every surface:

  - **SDK compatibility fixed (all surfaces).** The default template pinned a stale `@theokit/sdk ^2.25.0` while `theokit@0.43.0` peers `^4.0.1` — every freshly-scaffolded app installed an incompatible SDK 2.x. Bumped to `^4.0.1`, plus `@usetheo/ui ^0.14.0 → ^0.26.0` (the `@theokit/ui@1.x` peer). Guarded by a regression test.
  - **TUI surface: Claude-Code render.** `create-theokit --surface tui` now renders via `<AgentTimeline>` — assistant turns as Markdown (headings, lists, fenced code → syntax-highlighted code blocks) and tool calls as collapsible cards (`⎿` output) — instead of plain text. Bumped `@theokit/tui ^0.30.0 → ^0.32.0` and declared its `figlet`/`lowlight` peers (pnpm never auto-installs peers, so without them the TUI crashed at boot under pnpm). The app's own code + `@theokit/tui` are ai-free (project `useAgent().thread` via `messagesToAgentEvents`); `ai` stays a dep only for theokit's in-process agent runtime.
  - **Clean start.** The default agent tools import `tool` from the `theokit/server/define` sub-path instead of the deprecated umbrella `theokit/server`, so the TUI boots without a deprecation warning.

## 1.11.2

### Patch Changes

- f61b77f: Adopt `@theokit/sdk@3.x` (SE36 uniform `X.create()` API).

  SDK v3.0 removed the standalone factory functions in favor of static `X.create()` namespace methods. The `@theokit/agents` bridge now binds the new names — `Tool.create` (was `defineTool`), `SkillReadTool.create` (was `defineSkillReadTool`), `Retry.create` (was `withRetry`) — and the scaffold's code-defined skill uses `Skill.create` (was `createSkill`). While migrating, the tool-handler wrapper (`withRunContext`) was fixed to forward the **full** tool `ctx` — the SE12 `messages` transcript projection was being dropped, which would have silently broken a tool that reads the turn transcript; the handler types now track the SDK's canonical `CustomTool['handler']` instead of a hand-maintained duplicate.

  **Breaking (peer requirement):** `theokit` and `@theokit/agents` now require `@theokit/sdk >= 3.5.0` (and `@theokit/sdk-tools >= 0.9.1`, the SE36-migrated build). Apps on `@theokit/sdk@2.x` must upgrade — run `npx @theokit/codemod-sdk-3-0 --write` to migrate app code that calls the old factories directly.

## 1.11.1

### Patch Changes

- d186cb1: DX: move the `.skills()` mechanism explanation from the scaffold into the API's JSDoc.

  The `agents/chat.ts` scaffold carried a 4-line inline comment explaining _how_ skills work (the `<skills>` block + the on-demand `skill_read` tool). That belongs on the API, not in the developer's first file. The explanation now lives in the `.skills()` JSDoc (discoverable on hover / cmd-click) and the scaffold keeps a one-line pointer — so a freshly scaffolded `chat.ts` reads as intent (`​.skills([dailyBriefingSkill])`) with the "how" one hover away.

## 1.11.0

### Minor Changes

- c8ceb5e: `useAgent` now exposes the whole conversation as `thread`, not just the current turn (M46, #125, ADR-0058).

  The client store (`theokit/client/core`) accumulates a surface-agnostic `thread: UIMessage[]` — committed turns + the current user message + the in-flight streaming assistant — with stable message ids, committed exactly once, cleared only by `reset()`. Render `const { thread } = useAgent(...)` (or `createAgentClient(...).getState().thread` from the React-free core) instead of hand-rolling a transcript from per-turn `messages`. Same shape on web, desktop (Tauri) and TUI.

  - Per-turn `messages` keeps its exact back-compat semantics — `thread` is purely additive; existing call sites are untouched.
  - The `@theo/agents` codegen types `thread` automatically (it emits the `UseAgentReturn` interface name).
  - An errored or aborted turn is dropped rather than corrupting committed history; stale (aborted) drives never append.
  - **create-theokit:** the scaffolded web, TUI, and desktop apps now render `useAgent().thread` directly — the ~88-line hand-rolled transcript (local history + commit-once effect + inflight-merge) is gone from all three surface templates.

## 1.10.0

### Minor Changes

- **Scaffold shows how to add screens — a nav menu + an example route + docs — using TheoKit's own client
  primitives.** A one-route scaffold didn't indicate where a second screen goes. Now it does, without a dead
  demo, and it models `theokit/client` (not raw react-router):
  - `app/components/Nav.tsx` — the primary navigation menu, one entry per screen, using TheoKit's `Link`
    (react-router Link + route **prefetch** on hover/focus) + `useLocation` for the active route. Composed
    into the `Header`.
  - `app/about/page.tsx` — a real, self-documenting `/about` route (explains file-based routing, links back
    to the chat with TheoKit's `Link`, sets its `<title>` with TheoKit's `<Metadata>`, and tells you to
    delete it once you've got the idea). It works — not a fake screen.
  - `page.tsx` now sets its title via `<Metadata>` too, and carries a pointer comment on adding screens.
  - `docs/ARCHITECTURE.md` § **Adding a screen** — the folder convention (`app/settings/page.tsx` →
    `/settings`, dynamic `[id]`, catch-all `[...slug]`), the `theokit generate page <name>` command, and
    TheoKit's client primitives (`Link` prefetch, `Metadata`, `Image`, `theoFetch` + the `react-query`
    adapter) — reach for these over generic libraries.

  Note: a `pages/` folder holding routes is an anti-pattern here — `app/` **is** the pages layer (file-based
  routing: the folder path is the URL, so `app/pages/chat/page.tsx` would serve `/pages/chat`). That's the
  old Next.js Pages Router the App Router (which TheoKit follows) dropped.

## 1.9.1

### Patch Changes

- **docs: clarify that `loading`/`error`/`not-found` are route files, not components.** `docs/ARCHITECTURE.md`
  now spells out that the router binds `page`/`layout`/`loading`/`error`/`not-found` by name + location
  (they live at the route segment — the `app/` root for `/`), so they sit beside `components/`/`hooks/`/`lib/`
  by convention, not by mistake — and moving `loading.tsx` into `components/` would drop the route's loading
  UI. This is the Next.js App Router model TheoKit implements. No code change.

## 1.9.0

### Minor Changes

- **Scaffold frontend is now type-based (`components/` + `hooks/` + `lib/`).** The web `app/` was refactored
  from one folder into the layout most React apps grow into, with each bucket holding real, extracted code
  (no empty placeholder folders):
  - `app/components/` — `Header.tsx`, `ChatPanel.tsx` (transcript + starters), `Composer.tsx` (input + error
    - new-chat). Flat `.tsx`, Tailwind (no CSS modules), the shadcn/ai-chatbot convention.
  - `app/hooks/use-transcript.ts` — the transcript/streaming STATE hook (unit-tested).
  - `app/lib/constants.ts` — greeting + starter prompts.

  `page.tsx` is a thin composition root (lays out `<ChatPanel>` + `<Composer>`, pulls state from the hook);
  `layout.tsx` composes `<Header/>`. `utils/`/`styles/`/`assets/` are documented as the convention but not
  shipped empty (YAGNI). No `main.tsx`/`index.js`/`pages/` — the entry is framework-owned and routes are
  files (Next.js-style). `--bare` drops `components/`+`hooks/`+`lib/` and rewrites `layout.tsx` to an
  unstyled shell (also fixing a latent bare bug where `layout.tsx` imported the removed `@theokit/ui`).

## 1.8.0

### Minor Changes

- **Frontend organized semantically — state in a hook, feature internals in a private folder.** The web
  `app/` no longer inlines the chat's transcript logic + constants in a 158-line `page.tsx`. Following the
  pattern every serious chat frontend converges on (Vercel `ai-chatbot`, the AI SDK docs), the page is now
  the presentational **view**, and the transcript/streaming **state** lives in a hook. Files are grouped
  semantically:
  - route surface (`page` / `layout` / `error` / `loading` / `not-found`) stays at the `app/` root — the
    only files the router serves;
  - the chat feature's internals live in an **`app/chat/`** folder: `use-transcript.ts` (the transcript
    state hook, now unit-tested in `use-transcript.test.ts`) and `constants.ts` (greeting + starter prompts).

  `chat/` is never a route: a folder is only served when it holds a `page`/`layout`/… file (Next-style
  colocation), and `chat/` holds only the feature's modules. Grouping the feature in ONE folder — rather
  than scattering `hooks/` + `lib/` with a single file each — is feature-colocation that scales (a second
  feature becomes its own `<feature>/`). `docs/ARCHITECTURE.md` documents the split. `--bare` drops
  `app/chat/` too (its files import `@theokit/ui`, which bare removes).

## 1.7.0

### Minor Changes

- **Scaffold wires its skill in ONE call.** `agents/chat.ts` now uses just `.skills([dailyBriefingSkill])`
  (requires `@theokit/agents@^0.38.0`): registering the inline skill also auto-provisions the `skill_read`
  tool, so the separate `.tool(defineSkillReadTool([...]))` line + its import are gone. Same behaviour, half
  the wiring.

## 1.6.0

### Minor Changes

- **Default scaffold registers its skill via `.skills([...])`, not just a read tool.** `agents/chat.ts`
  now wires the inline `dailyBriefingSkill` with `.skills([dailyBriefingSkill])` (requires
  `@theokit/agents@^0.37.0`), so the SDK lists the skill's name + description in the `<skills>` system-prompt
  block automatically. The persona no longer hardcodes the skill name — the model discovers it from the
  block, then loads the body on demand via the `skill_read` tool (`defineSkillReadTool`). Removes the
  previous workaround (skill name repeated in the prompt).

## 1.1.1

### Patch Changes

- deb93bf: **M45 fix — the scaffolded `--surface tui|desktop` apps now install + type-check.** Found by running every
  `--surface` scenario end-to-end (real `npm install` resolution + `tsc`):

  - **`react-router` was wrongly dropped** for tui/desktop. `theokit` declares it a REQUIRED peer, so removing
    it broke `npm install` (unsatisfied peer). It is kept now (unused by tui/desktop, but the peer must resolve).
  - **`ai` was missing** from the tui/desktop deps. It was transitive via `@theokit/ui` (dropped for those
    surfaces), but the unified client (`useAgent` / `createAgentClient`) consumes the `ai` UIMessageStream
    reader at runtime. Declared explicitly now.
  - **`JSX.Element` → `ReactElement`** in the Ink `App.tsx` template. React 19 removed the global `JSX`
    namespace, so `JSX.Element` failed to type-check; the component returns `ReactElement` now.

  A comprehensive `surface-matrix` test now exercises every scenario (all `--surface` forms + invalid,
  web/tui/desktop full trees, `--surface` composing with `--backend`, forced-error rollback) and asserts
  the deps, scripts, tsconfig `include`, and unified-client wiring. The tui `InProcessTransport` run binding
  (`streamAgentTurnInProcess`) is type-sound: the client `ApprovalDecision` is structurally identical to the
  SDK's `HitlDecision`.

## 1.1.0

### Minor Changes

- 79b7ed9: **M45 — `create-theokit --surface web|tui|desktop`: scaffold the three surfaces on the unified client.**

  `create-theokit` can now generate a terminal (Ink) or desktop (Tauri) agent app, not just web.
  `--surface` is a flag (mirrors `--backend`): `--surface tui` scaffolds an Ink app whose component drives
  `useAgent(new InProcessTransport({ run: (i) => streamAgentTurnInProcess(mod, apiKey, i) }))` (M41);
  `--surface desktop` scaffolds a Tauri app — a Node **sidecar** (`streamAgentTurnInProcess` → JSONL, the
  M35/M36 server seam), a Rust `src-tauri` shell that pushes sidecar lines over a `Channel`, and a
  vanilla-JS webview that consumes them via `createAgentClient(new ChannelTransport({ source }))` from the
  React-FREE `theokit/client/core` (M42 + M44). Each scaffolded surface uses the UNIFIED client (the
  DX-track payoff — TUI exercises M41, Desktop exercises M42 + M44's no-React client), NOT the raw seam.
  `--surface web` (default) is unchanged. The Ink/Tauri/Rust boilerplate lives entirely in the scaffolder
  templates — framework core stays Tauri/Ink-agnostic (ADR-0045 preserved), and `--surface` is a flag, not
  a new top-level template (ADR-0023 default-only preserved). `--bare` refuses to combine with a
  non-web surface (it strips the agent deps those surfaces need). ADR-0054.

  > Evidence boundary (honest): the scaffold correctness (files present, unified-client wiring, web-only
  > deps dropped, `{{name}}` substituted) is validated by the test suite. The generated TUI's real run
  > (needs an LLM key + a TTY) and the Desktop's full Tauri **Rust build + GUI** are toolchain/key-gated —
  > the Rust boilerplate mirrors the proven `theo-code-v2/apps/desktop` reference.

## 1.0.17

### Patch Changes

- 25f7723: Fix (#79): the shipped `theokit-agents` skill doc taught the wrong `defineAgentTool` signature —
  `{ input, execute }` returning an object. The real API (`DefineAgentToolSpec`) is
  `{ inputSchema, handler }` where `handler` returns a **string**; a user copying the doc got code
  that failed `tsc`. Corrected the example, fixed a stale `@theokit/sdk-tools` tool name in the
  "you are here" map (`createSearchTool` → `createSearchTextTool`/`createGlobTool`/`createShellTool`),
  and added a regression guard test that asserts the doc's `defineAgentTool` block uses `inputSchema` +
  `handler` (fail-closed on future drift).
- 6a91f17: Fix (#81): `defineAgent({ tools })` now type-accepts the `@theokit/sdk` `CustomTool` that `defineAgentTool` and every `@theokit/sdk-tools` factory return (previously `CustomTool` was not assignable to the internal `CompiledTool`, so the documented tool pattern failed `tsc` even though it ran). The `tools` field is typed `readonly CustomTool[]` and normalized to `CompiledTool` at compile.

  Fix (#80): the `create-theokit` default template now type-checks, builds, AND renders on a fresh scaffold. `app/page.tsx` was migrated to the `@theokit/ui@1.0.0` auto-dispatch chat API (`ChatMessage` takes a `UIMessage` and renders its parts; the old manual `Message`/`ToolCallCard` flatten is gone), the template ships `@types/node` + `experimentalDecorators`/`emitDecoratorMetadata` (so tool handlers and the `@Agent` class surface type-check), and a jsdom render test (`app/page.test.tsx`) guards against future `@theokit/ui` drift. A pristine scaffold now passes `tsc --noEmit` with 0 errors (was 7).

## 1.0.16

### Patch Changes

- 2302dcb: M6 dogfood fixes — two real V1 bugs surfaced by a live `npx create-theokit` run.

  - **Tool calls crashed** (`TypeError: ... reading 'def'`): `buildSdkTools` re-ran `defineAgentTool`'s
    already-lowered JSON-Schema tool through the SDK's `defineTool` (which expects a live Zod schema).
    It now routes by `inputSchema` shape — Zod schema → `defineTool`; already-SDK-ready `CustomTool`
    (JSON-Schema `inputSchema`) → forwarded raw. Regression test + confirmed minimal repro.
  - **Fresh scaffold failed to start** (`ERR_PACKAGE_PATH_NOT_EXPORTED` on `@theokit/sdk/compaction`):
    the default template pinned `@theokit/sdk@^1.1.0`, below the `@theokit/agents@0.30.0` peer floor
    (`>= 2.13.0`). Bumped the template + fixture pins to `^2.13.0`.

## 1.0.15

### Patch Changes

- Default template now boots end-to-end. Pinned `theokit` to `^0.6.0` and `zod` to `^4.0.0` (the framework requires zod 4 / `z.url()` — apps previously crashed at config load with `z.url is not a function`). Aligned `@theokit/ui` to `^0.14.0`, fixing the `ERESOLVE` peer conflict that aborted `npm install` on a fresh scaffold. Added `pnpm.onlyBuiltDependencies` so pnpm 11 pre-approves native build scripts.
- Default template is the agent chat surface (`@theokit/ui` chat thread + a streaming `chat.ts` wired to `@theokit/sdk`).

## 0.4.0-beta.0

### Major Changes

- **Version locked to `theokit@0.4.0-beta.0`** per the `.changeset/config.json` linked invariant. `create-theokit` itself ships no template-content changes in this release — all 5 templates (default / saas / dashboard / api-only / postgres) were verified to already use the directory-nested router convention required by `theokit@0.4.0-beta.0`. Strangers scaffolding fresh apps see no migration prompt; existing apps run `npx theokit migrate router` once after upgrading.

## 0.2.1

### Patch Changes

- **Template pins bumped to stable** — `theokit` `^0.1.0-alpha.16` → `^0.2.0`, `@theokit/sdk` `^1.2.0` → `^1.3.0`, `@theokit/ui` `^0.12.0-next.0` → `^0.12.0` across all 5 templates. Strangers now scaffold against current stable releases.
- **`default/server/routes/chat.ts`** — model id prefixed with provider namespace (`openai/gpt-4o-mini` instead of bare `gpt-4o-mini`) so OpenRouter routing resolves correctly. Without the prefix the SDK fell back to a stub response.
- **`default/app/page.tsx`** TS errors fixed — `AgentErrorCard` `kind="model"` → `kind="tool-failure"`, `description=` → `detail=`, `action=` → `actions=` (real props from `@theokit/ui >= 0.12.0`). `QuickAction.label` narrowed to `string` before `handleSubmit()`.
- **`default/server/crons/cleanup-conversations.ts`** — dropped non-existent `CronContext.log` for plain `console.info` JSON lines; typed `entries: Dirent[]` for `node:fs` strict mode.
- **All 5 templates devDeps** — added `@types/node ^22.10.0` (resolves missing module errors).

### Why

`/dogfood-stranger` run 2026-05-30 surfaced 7 TS errors on a freshly scaffolded `default` project + a CRITICAL chat path failure (SDK returned canned response instead of calling the real provider). Root cause: bare model id + stale alpha pins incompatible with current `@theokit/sdk` / `@theokit/ui` releases. This patch fixes both at the template source.

## 0.2.0

### Minor Changes

- ee1b596: **Templates DX overhaul + scaffold SDK wiring (fix EC-S2/S3/S6 do dogfood-stranger run 2026-05-28)**
  - **`create-theokit` templates** (default/dashboard/api-only/postgres/saas):
    - Scripts completos: `dev` + `build` + `start` + `typecheck` declarados em todos
    - `.nvmrc` com `22.12` em todos
    - `public/favicon.ico` em todos (resolve 404 cosmético EC-S8)
    - `drizzle-kit` em devDeps de postgres + saas (EC-10 SHOULD TEST)
  - **`theokit` framework** (theokit/packages/theo):
    - `vite-plugin/theoui-detect.ts` refatorado: substituído `createRequire(...).resolve()` por filesystem walk + leitura de `package.json:exports[subpath]`. **Resolve EC-S4 root cause** (Page não hidratava) — Chrome MCP confirmou `<main>`, `<header>`, `<textarea>` agora renderizam.
    - `vite-plugin/auto-detect.ts` refatorado: mesma técnica filesystem walk (eliminação de `createRequire`).
    - D13 invariant gated por `tests/integration/no-require-on-esm-only-deps.test.ts` (2 BDD it()) — previne regressão de require em `@theokit/ui` (ESM-only by design).
    - Playwright spec `tests/e2e/scaffold-page-hydrates.spec.ts` (4 BDD it()) — required CI check para hydration regression.

  ADRs:
  - [`theokit/docs/adr/0021-dogfood-stranger-coverage-expansion.md`](docs/adr/0021-dogfood-stranger-coverage-expansion.md) — D4-D14
  - [`theokit/docs/adr/0022-create-theokit-republish-with-sdk-wired.md`](docs/adr/0022-create-theokit-republish-with-sdk-wired.md) — D2/D3/D10

  Plan: [`.claude/knowledge-base/plans/dogfood-fixes-and-coverage-expansion-plan.md`](../../.claude/knowledge-base/plans/dogfood-fixes-and-coverage-expansion-plan.md) v1.1 FAANG-grade.

- 4b97fee: TheoUI default integration — `npx create-theokit my-app` now scaffolds a working agent surface out of the box.

  **`theokit`** (`0.1.0-alpha.2`)
  - `defineAgentEndpoint({ handler })` (`theokit/server`) — sugar over `defineRoute` that turns an `async *handler(): AsyncGenerator<AgentEvent>` into a Server-Sent Events response. Standards-compliant `text/event-stream` framing; respects `request.signal` for prompt cancellation; emits a final `{ type: 'error', message }` event when the generator throws.
  - `useAgentStream(path, options?)` (`theokit/client`) — React hook returning `{ events, status, send, abort, reset }`. Transport is `fetch + ReadableStream` (not `EventSource` — POST + body required). Cleans up on unmount (StrictMode-safe).
  - `consumeAgentStream(path, options)` + `parseSSEChunk(line)` (`theokit/client`) — the pure primitive the hook glues, exposed for non-React consumers and for tests.
  - Runtime `AgentEvent` discriminated union (`message | tool_call | tool_result | error`) exported from `theokit/server` and `theokit/client`. Server emits, client consumes — no cross-package type coupling with `@theokit/ui`.
  - Auto-injection of `@theokit/ui` in the dev/build pipeline: when the user's project declares `@theokit/ui` as a dependency and the package resolves, the Vite plugin emits `import '@theokit/ui/styles.css'`, `import '@theokit/ui/fonts.css'` (or `fonts-cdn.css` when configured), and wraps `RouterProvider` in `<TheoUIProvider theme={{ defaultTheme }}>`. New optional `ui` field in `theo.config.ts` (`false | { theme, fonts }`) for opt-out and theme selection. Conservative detection: package must be declared in `package.json` AND resolvable — prevents false positives in monorepos.

  **`create-theokit`** (`0.1.0-alpha.2`)
  - Default template now scaffolds an **agent surface**: `app/page.tsx` ships `AgentComposer` + `AgentTimeline` from `@theokit/ui`, `server/routes/chat.ts` is a mock SSE endpoint emitting three `AgentEvent`s. Replace the mock with your real LLM provider.
  - New `--bare` flag — skips the TheoUI defaults for users who want a minimal scaffold. Atomic rollback: if the bare transform fails for any reason (filesystem perms etc.), the entire target directory is removed so no half-scaffolded project is left behind. `--bare` is only valid with `--template=default`.
  - `@theokit/ui ^0.1.0-next.0` is now a direct dependency of the default template.

- ee1b596: **0.2.0 — Exit alpha + enforcement cutover (CSRF strict + CSP enforce).**

  This release ends the `0.1.0-alpha.*` series and ships TheoKit's first `minor` on the `latest` npm tag. It combines the maturity work consolidated under the macro-roadmap convergence list (items #1-#6 done: scaffold + agent surface + canonical chat via `@theokit/sdk` + `defineAgentTool` + `streamAgentRun` + `createConversationHistory` + example `full-stack-agent`) with the security defaults flip previously planned as 0.3.0 (commit `3ee9dac`).

  **BREAKING (per pre-1.0 semver — `minor` = breaking until 1.0):**
  - `config.security.csrf` default flipped from `'warn'` → **`'strict'`**. Every non-GET request without the `X-Theo-Action: 1` header now returns 403 `CSRF_INVALID`. The framework's own `useAgentStream` already attaches this header (`packages/theo/src/client/agent-stream-core.ts:75`); custom fetchers, raw `<form>` posts, third-party clients, and curl-based integrations must attach the header explicitly or set `csrf: 'warn'` / `csrf: 'off'` in `defineConfig` during migration.
  - `config.security.headers.cspMode` default flipped from `'report-only'` → **`'enforce'`**. Inline scripts without a per-request nonce are blocked. The SSR hydration data script the framework emits carries the nonce automatically (T7.4 wiring verified by `tests/e2e/ssr-nonce.spec.ts` 3/3 GREEN). Third-party widgets (gtag, intercom, sentry, Plausible) and any user-authored inline `<script>` must either use the nonce mechanism or set `cspMode: 'report-only'` during migration.

  **Migration path:**
  - See `docs/migration/0.2-to-0.3.md` for the audit-grep recipes (`grep '"event":"csrf.warn"' logs.json | jq '.path'` to enumerate affected endpoints).
  - Run `theokit check --upgrade-readiness 0.3` (CLI command shipped) for a static analysis of inline scripts in your `app/**` tree.
  - If you cannot fix immediately: opt out in `theo.config.ts` via `defineConfig({ security: { csrf: 'warn', headers: { cspMode: 'report-only' } } })` and migrate at your pace.

  **Also in this release:**
  - All maturity-hardening primitives (jobs / crons / webhooks / cost tracking / transactional outbox / W3C trace context).
  - TheoCloud adapter Wave 2 stub registered (Wave 3 K8s manifest emission ships in 0.6.0).
  - Devtools overlay (auto-injected dev-only floating chip + 5-tab panel).
  - Argon2id password hashing in `examples/agent-saas` via `hash-wasm`.
  - Playwright coverage for all 5 templates (`default`, `dashboard`, `api-only`, `postgres`, `saas`).
  - Native bindings preflight (`scripts/preflight-native-bindings.mjs`) detects + auto-rebuilds `better-sqlite3` ABI mismatch on test setup. See CLAUDE.md > "Native bindings discipline".

  **Honest residual:**

  The 4-6 week warn-mode telemetry window from the original 0.3.0 plan is collapsed into a single 0.2.0 release for shipping pragmatism. Consumers who need a true warn-mode interim should pin `0.1.0-alpha.17` (last alpha) and use the migration guide to transition deliberately.

### Patch Changes

- ee1b596: **FAANG-grade provider routing — Strategy + Registry pattern.**

  Provider resolution moved from per-template conditionals into a centralized Strategy + Registry inside `theokit/server`. Consumers (template `chat.ts`, fixtures) now ship **zero conditionals on provider** — the framework resolves `apiKey` + `baseUrl` automatically from the highest-priority env var present (`OPENROUTER_API_KEY` > `OPENAI_API_KEY` > `ANTHROPIC_API_KEY`).

  Inspired by Dapr Conversation Registry (`dapr/pkg/components/conversation/registry.go`) and Encore Manager provider array (`encore/runtimes/go/pubsub/manager_internal.go`).

  **New public API in `theokit/server`:**
  - `resolveProvider(): ResolvedProvider` — throws actionable error if no env var present
  - `tryResolveProvider(): ResolvedProvider | null` — graceful degradation
  - `registerProvider(descriptor: ProviderDescriptor): void` — runtime extension point (idempotent by name)
  - `resetProviderRegistry(): void` — test-only / dev escape hatch
  - `listProviders(): readonly ProviderDescriptor[]` — sorted by priority

  **`createConversationHistory` upgrade:** auto-injects `apiKey` + `providers.routes[0]` (capability=chat) into SDK options when consumer omits `options.apiKey`. Explicit `options.apiKey` always wins (escape hatch preserved).

  **Template `chat.ts` is now FAANG-clean** — pure `model: { id: 'gpt-4o-mini' }`, no `process.env.*` reads, no provider conditionals, no manual error yields.

  **Wire protocol:** OpenAI Chat Completions (universal — every provider implements it). Anthropic uses native Messages API behind the same Strategy abstraction.

- ee1b596: **theokit-evolution-ci-and-dx onda — CI gates + template DX + devtools observability.**

  This release ships 6 deliverables from the `theokit-evolution-ci-and-dx-plan.md` v1.1:

  **Templates dogfood primitives 0.5.0 (Phase 2B):**
  - `default` + `dashboard` ship `server/crons/cleanup-conversations.ts` (daily GC of stale `.theokit/agents/*` >30d)
  - `api-only` ships `server/routes/webhooks/echo.ts` (HMAC-SHA256 self-signed pattern)
  - `postgres` ships `server/jobs/log-message.ts` (defineJob enqueue pattern, ADR-0003 transactional outbox compliant)
  - `saas` ships `server/routes/billing/stripe-webhook.ts` (Stripe HMAC verify) + wires `trackAgentRun` in `server/routes/agent.ts`

  **README docs link (Phase 2A):**
  - All 5 templates ship `📚 Full docs: https://docs.theokit.dev` in header

  **Devtools `Agents` tab (Phase 3):**
  - New tab in devtools panel showing per-run telemetry: time, user, model, tokens in/out, cost USD, status
  - `dispatcher.onAgentRun(record)` wired from `trackAgentRun` in dev mode
  - Tree-shaken in prod via universal `__IS_DEV` IIFE guard (Vite OR tsup) — devtools-treeshake test stays GREEN
  - Ring buffer cap RING_BUFFER_CAP (50) for high-throughput resilience
  - Reducer: `AGENT_RUN_ADD` + `RESET_AGENT_RUNS` actions

  **Internals:**
  - `AgentRunRecord` type + `CHANNEL_AGENT_RUN` channel in `devtools/shared.ts`
  - `trackAgentRun` extended with optional `status` field (default 'finished')

  No breaking changes; all wiring is additive + opt-in via dev mode.

- ee1b596: Fix template default chat.ts modelId: substituído `openrouter/anthropic/claude-3.5-sonnet` (model ID inválido — OpenRouter rejeita 400) por `openai/gpt-4o-mini` (cheap, always-available, empíricamente testado 2026-05-28). Resolve falha "openrouter API error: unknown (HTTP 404)" em stranger Phase 7 real LLM test.
- ee1b596: Fix template default chat.ts: adiciona `providers: { routes: [{ capability: 'chat', provider: 'openrouter' }] }` quando OPENROUTER_API_KEY presente. Sem isso, SDK inferia provider do prefixo do model id (`openai/gpt-4o-mini` → tentava OpenAI direto, exigindo `OPENAI_API_KEY`). Stranger agora pode usar APENAS OPENROUTER_API_KEY e tudo roteia corretamente.
- 4b97fee: Hotfix: default template now declares `react-router` and `zod` (theokit peer dependencies). Without these, `pnpm dev` failed immediately on a freshly scaffolded project — entry-client couldn't resolve `react-router`, and `server/routes/chat.ts` couldn't resolve `zod`. Found by running `pnpm dlx create-theokit my-app` end-to-end against the published packages. Regression test added in `tests/unit/scaffold-default-agent.test.ts` to keep peer deps locked to the template.

  Also bumps the template's `theokit` pin to `^0.1.0-alpha.4` so freshly scaffolded projects pick up this hotfix.

- ee1b596: Bump `@theokit/ui` pin em templates de `^0.11.0-next.0` para `^0.12.0-next.0` (alinha com npm dist-tag latest pós-T1.1).
- ee1b596: **Template default chat.ts: surface provider errors as AgentEvent `error`.**

  Pre-fix: `streamAgentRun(run)` could silently close SSE when SDK throws on
  invalid OPENROUTER_API_KEY / rate-limit / model-not-found / 5xx. Client saw
  a closed stream with no actionable message — stranger lost context.

  Post-fix: full agent lifecycle wrapped in try/catch + caught exceptions
  yield `{ type: 'error', message: ... }` AgentEvent. Dogfood chaos Phase 12
  (invalid-key) now PASSES end-to-end.

  Validated via `run-headless.sh` Phase 5 dogfood automation
  (`dogfood-fixes-and-coverage-expansion-plan.md` v1.1 Phase 5).

- ee1b596: **Template fix: `pnpm.onlyBuiltDependencies: ["esbuild"]` para destravar pnpm 11+ approve-builds gate.**

  Sem esse hint, `pnpm install` + `theokit dev` falham com `ERR_PNPM_IGNORED_BUILDS` em pnpm 11+ (security default: build scripts de transitivas como esbuild não rodam sem aprovação explícita). Como esbuild é dep transitiva mandatória do Vite, declaramos o opt-in nos 5 templates oficiais (default, dashboard, api-only, postgres, saas).

  Stranger executando `npx create-theokit my-app && cd my-app && pnpm install && pnpm dev` agora funciona end-to-end sem `pnpm approve-builds` interactive prompt.

- ee1b596: **Template SDK bump → `@theokit/sdk@^1.2.0` (D14 fault injection available).**

  New scaffolds get the SDK with `THEOKIT_TEST_RESPONSE_OVERRIDE` fault-injection seam built in. Documented in the SDK's `docs.md` § "Test fault injection (v1.22+)". Use in `dogfood-stranger` Phase 13 (rate-limit chaos) for zero-cost / zero-quota-burn deterministic 429 / 5xx / 401 scenarios.

  No theokit code changes — this is a template-side dep bump.

## 0.1.0-alpha.15

### Patch Changes

- **Template default chat.ts: surface provider errors as AgentEvent `error`.**

  Pre-fix: `streamAgentRun(run)` could silently close SSE when SDK throws on
  invalid OPENROUTER_API_KEY / rate-limit / model-not-found / 5xx. Client saw
  a closed stream with no actionable message — stranger lost context.

  Post-fix: full agent lifecycle wrapped in try/catch + caught exceptions
  yield `{ type: 'error', message: ... }` AgentEvent. Dogfood chaos Phase 12
  (invalid-key) now PASSES end-to-end.

  Validated via `run-headless.sh` Phase 5 dogfood automation
  (`dogfood-fixes-and-coverage-expansion-plan.md` v1.1 Phase 5).

## 0.1.0-alpha.14

### Patch Changes

- **theokit-evolution-ci-and-dx onda — CI gates + template DX + devtools observability.**

  This release ships 6 deliverables from the `theokit-evolution-ci-and-dx-plan.md` v1.1:

  **Templates dogfood primitives 0.5.0 (Phase 2B):**
  - `default` + `dashboard` ship `server/crons/cleanup-conversations.ts` (daily GC of stale `.theokit/agents/*` >30d)
  - `api-only` ships `server/routes/webhooks/echo.ts` (HMAC-SHA256 self-signed pattern)
  - `postgres` ships `server/jobs/log-message.ts` (defineJob enqueue pattern, ADR-0003 transactional outbox compliant)
  - `saas` ships `server/routes/billing/stripe-webhook.ts` (Stripe HMAC verify) + wires `trackAgentRun` in `server/routes/agent.ts`

  **README docs link (Phase 2A):**
  - All 5 templates ship `📚 Full docs: https://docs.theokit.dev` in header

  **Devtools `Agents` tab (Phase 3):**
  - New tab in devtools panel showing per-run telemetry: time, user, model, tokens in/out, cost USD, status
  - `dispatcher.onAgentRun(record)` wired from `trackAgentRun` in dev mode
  - Tree-shaken in prod via universal `__IS_DEV` IIFE guard (Vite OR tsup) — devtools-treeshake test stays GREEN
  - Ring buffer cap RING_BUFFER_CAP (50) for high-throughput resilience
  - Reducer: `AGENT_RUN_ADD` + `RESET_AGENT_RUNS` actions

  **Internals:**
  - `AgentRunRecord` type + `CHANNEL_AGENT_RUN` channel in `devtools/shared.ts`
  - `trackAgentRun` extended with optional `status` field (default 'finished')

  No breaking changes; all wiring is additive + opt-in via dev mode.

## 0.1.0-alpha.13

### Patch Changes

- **Template fix: `pnpm.onlyBuiltDependencies: ["esbuild"]` para destravar pnpm 11+ approve-builds gate.**

  Sem esse hint, `pnpm install` + `theokit dev` falham com `ERR_PNPM_IGNORED_BUILDS` em pnpm 11+ (security default: build scripts de transitivas como esbuild não rodam sem aprovação explícita). Como esbuild é dep transitiva mandatória do Vite, declaramos o opt-in nos 5 templates oficiais (default, dashboard, api-only, postgres, saas).

  Stranger executando `npx create-theokit my-app && cd my-app && pnpm install && pnpm dev` agora funciona end-to-end sem `pnpm approve-builds` interactive prompt.

## 0.1.0-alpha.12

### Patch Changes

- **Template SDK bump → `@theokit/sdk@^1.2.0` (D14 fault injection available).**

  New scaffolds get the SDK with `THEOKIT_TEST_RESPONSE_OVERRIDE` fault-injection seam built in. Documented in the SDK's `docs.md` § "Test fault injection (v1.22+)". Use in `dogfood-stranger` Phase 13 (rate-limit chaos) for zero-cost / zero-quota-burn deterministic 429 / 5xx / 401 scenarios.

  No theokit code changes — this is a template-side dep bump.

## 0.1.0-alpha.11

### Patch Changes

- **FAANG-grade provider routing — Strategy + Registry pattern.**

  Provider resolution moved from per-template conditionals into a centralized Strategy + Registry inside `theokit/server`. Consumers (template `chat.ts`, fixtures) now ship **zero conditionals on provider** — the framework resolves `apiKey` + `baseUrl` automatically from the highest-priority env var present (`OPENROUTER_API_KEY` > `OPENAI_API_KEY` > `ANTHROPIC_API_KEY`).

  Inspired by Dapr Conversation Registry (`dapr/pkg/components/conversation/registry.go`) and Encore Manager provider array (`encore/runtimes/go/pubsub/manager_internal.go`).

  **New public API in `theokit/server`:**
  - `resolveProvider(): ResolvedProvider` — throws actionable error if no env var present
  - `tryResolveProvider(): ResolvedProvider | null` — graceful degradation
  - `registerProvider(descriptor: ProviderDescriptor): void` — runtime extension point (idempotent by name)
  - `resetProviderRegistry(): void` — test-only / dev escape hatch
  - `listProviders(): readonly ProviderDescriptor[]` — sorted by priority

  **`createConversationHistory` upgrade:** auto-injects `apiKey` + `providers.routes[0]` (capability=chat) into SDK options when consumer omits `options.apiKey`. Explicit `options.apiKey` always wins (escape hatch preserved).

  **Template `chat.ts` is now FAANG-clean** — pure `model: { id: 'gpt-4o-mini' }`, no `process.env.*` reads, no provider conditionals, no manual error yields.

  **Wire protocol:** OpenAI Chat Completions (universal — every provider implements it). Anthropic uses native Messages API behind the same Strategy abstraction.

## 0.1.0-alpha.10

### Patch Changes

- Fix template default chat.ts: adiciona `providers: { routes: [{ capability: 'chat', provider: 'openrouter' }] }` quando OPENROUTER_API_KEY presente. Sem isso, SDK inferia provider do prefixo do model id (`openai/gpt-4o-mini` → tentava OpenAI direto, exigindo `OPENAI_API_KEY`). Stranger agora pode usar APENAS OPENROUTER_API_KEY e tudo roteia corretamente.

## 0.1.0-alpha.9

### Patch Changes

- Fix template default chat.ts modelId: substituído `openrouter/anthropic/claude-3.5-sonnet` (model ID inválido — OpenRouter rejeita 400) por `openai/gpt-4o-mini` (cheap, always-available, empíricamente testado 2026-05-28). Resolve falha "openrouter API error: unknown (HTTP 404)" em stranger Phase 7 real LLM test.

## 0.1.0-alpha.7

### Patch Changes

- Bump `@theokit/ui` pin em templates de `^0.11.0-next.0` para `^0.12.0-next.0` (alinha com npm dist-tag latest pós-T1.1).

## 0.1.0-alpha.6

### Minor Changes

- **Templates DX overhaul + scaffold SDK wiring (fix EC-S2/S3/S6 do dogfood-stranger run 2026-05-28)**
  - **`create-theokit` templates** (default/dashboard/api-only/postgres/saas):
    - Scripts completos: `dev` + `build` + `start` + `typecheck` declarados em todos
    - `.nvmrc` com `22.12` em todos
    - `public/favicon.ico` em todos (resolve 404 cosmético EC-S8)
    - `drizzle-kit` em devDeps de postgres + saas (EC-10 SHOULD TEST)
  - **`theokit` framework** (theokit/packages/theo):
    - `vite-plugin/theoui-detect.ts` refatorado: substituído `createRequire(...).resolve()` por filesystem walk + leitura de `package.json:exports[subpath]`. **Resolve EC-S4 root cause** (Page não hidratava) — Chrome MCP confirmou `<main>`, `<header>`, `<textarea>` agora renderizam.
    - `vite-plugin/auto-detect.ts` refatorado: mesma técnica filesystem walk (eliminação de `createRequire`).
    - D13 invariant gated por `tests/integration/no-require-on-esm-only-deps.test.ts` (2 BDD it()) — previne regressão de require em `@theokit/ui` (ESM-only by design).
    - Playwright spec `tests/e2e/scaffold-page-hydrates.spec.ts` (4 BDD it()) — required CI check para hydration regression.

  ADRs:
  - [`theokit/docs/adr/0021-dogfood-stranger-coverage-expansion.md`](docs/adr/0021-dogfood-stranger-coverage-expansion.md) — D4-D14
  - [`theokit/docs/adr/0022-create-theokit-republish-with-sdk-wired.md`](docs/adr/0022-create-theokit-republish-with-sdk-wired.md) — D2/D3/D10

  Plan: [`.claude/knowledge-base/plans/dogfood-fixes-and-coverage-expansion-plan.md`](../../.claude/knowledge-base/plans/dogfood-fixes-and-coverage-expansion-plan.md) v1.1 FAANG-grade.

## 0.1.0-alpha.4

### Patch Changes

- Hotfix: default template now declares `react-router` and `zod` (theokit peer dependencies). Without these, `pnpm dev` failed immediately on a freshly scaffolded project — entry-client couldn't resolve `react-router`, and `server/routes/chat.ts` couldn't resolve `zod`. Found by running `pnpm dlx create-theokit my-app` end-to-end against the published packages. Regression test added in `tests/unit/scaffold-default-agent.test.ts` to keep peer deps locked to the template.

  Also bumps the template's `theokit` pin to `^0.1.0-alpha.4` so freshly scaffolded projects pick up this hotfix.

## 0.1.0-alpha.3

### Minor Changes

- TheoUI default integration — `npx create-theokit my-app` now scaffolds a working agent surface out of the box.

  **`theokit`** (`0.1.0-alpha.2`)
  - `defineAgentEndpoint({ handler })` (`theokit/server`) — sugar over `defineRoute` that turns an `async *handler(): AsyncGenerator<AgentEvent>` into a Server-Sent Events response. Standards-compliant `text/event-stream` framing; respects `request.signal` for prompt cancellation; emits a final `{ type: 'error', message }` event when the generator throws.
  - `useAgentStream(path, options?)` (`theokit/client`) — React hook returning `{ events, status, send, abort, reset }`. Transport is `fetch + ReadableStream` (not `EventSource` — POST + body required). Cleans up on unmount (StrictMode-safe).
  - `consumeAgentStream(path, options)` + `parseSSEChunk(line)` (`theokit/client`) — the pure primitive the hook glues, exposed for non-React consumers and for tests.
  - Runtime `AgentEvent` discriminated union (`message | tool_call | tool_result | error`) exported from `theokit/server` and `theokit/client`. Server emits, client consumes — no cross-package type coupling with `@theokit/ui`.
  - Auto-injection of `@theokit/ui` in the dev/build pipeline: when the user's project declares `@theokit/ui` as a dependency and the package resolves, the Vite plugin emits `import '@theokit/ui/styles.css'`, `import '@theokit/ui/fonts.css'` (or `fonts-cdn.css` when configured), and wraps `RouterProvider` in `<TheoUIProvider theme={{ defaultTheme }}>`. New optional `ui` field in `theo.config.ts` (`false | { theme, fonts }`) for opt-out and theme selection. Conservative detection: package must be declared in `package.json` AND resolvable — prevents false positives in monorepos.

  **`create-theokit`** (`0.1.0-alpha.2`)
  - Default template now scaffolds an **agent surface**: `app/page.tsx` ships `AgentComposer` + `AgentTimeline` from `@theokit/ui`, `server/routes/chat.ts` is a mock SSE endpoint emitting three `AgentEvent`s. Replace the mock with your real LLM provider.
  - New `--bare` flag — skips the TheoUI defaults for users who want a minimal scaffold. Atomic rollback: if the bare transform fails for any reason (filesystem perms etc.), the entire target directory is removed so no half-scaffolded project is left behind. `--bare` is only valid with `--template=default`.
  - `@theokit/ui ^0.1.0-next.0` is now a direct dependency of the default template.

## [Unreleased]

### Changed

- License set to **Apache-2.0** (was unset in `package.json`). Aligns with Theo open-core pillars — see root `CLAUDE.md` strategic review of 2026-05-14.

## [0.1.0-alpha.0] - 2026-05-09

### Added

- `create-theo` CLI for scaffolding new Theo projects
- 3 templates: `default` (Hello Theo + health route), `dashboard` (nested layouts), `api-only` (API routes)
- `--template` flag for template selection
- Package manager detection (npm, pnpm, yarn, bun)
- Automatic dependency installation after scaffold
- Clear error messages for invalid project names and missing templates
