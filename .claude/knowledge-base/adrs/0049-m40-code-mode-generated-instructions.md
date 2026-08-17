# ADR 0049 — M40: Code Mode generated `instructions` (return `{ tool, instructions }`)

**Status:** Accepted (2026-07-12) — return-shape GATE for M40.
**Context slice:** ROADMAP M40; the DX-legitimate gap from the Mastra **Code Mode** comparison.

## Context

M29 (ADR-0041) ships `createCodeMode(config): CustomTool` — agent-authored code runs in an INJECTED vetted sandbox, orchestrating declared tools via a permission-gated restricted `api` object, with per-instance allow-list scoping. Mastra's Code Mode additionally returns a generated `instructions` string that teaches the model the code contract + the available bridged calls. TheoKit returns only the tool, so the app must hand-write that prompt. M40 closes that DX gap.

Discovery facts:

1. **`CustomTool` = `{ name, description, inputSchema, handler }`** (SDK). `inputSchema` is a JSON-Schema Draft-7 `object`. There is **no `outputSchema`** (the handler returns a string) — so generated instructions render the INPUT surface only (honest to what exists).
2. **The only in-repo consumer of `createCodeMode` is `tests/unit/code-mode.test.ts`** (plus the public barrel export). No example app consumes it.
3. **`createCodeMode` already captures `config.tools`** (the allow-list) — the instructions generate from that same data (DRY: cannot drift from the surface).

## Decision

**D1 — Breaking return shape: `createCodeMode(config): { tool: CustomTool; instructions: string }`.** Chosen over the additive alternative (attach `.instructions` to the returned tool) because:
- **Semantic correctness:** the instructions belong in the AGENT's system prompt (`instructions: [..., codeMode.instructions]`), NOT as a field of the tool object that flows to the SDK. Attaching `.instructions` to the `CustomTool` leaks a non-tool field into the tool contract.
- **Mastra parity:** `{ tool, instructions }` is the SOTA shape (the reference the milestone mirrors).
- **Low blast radius:** theokit is pre-1.0 (0.x — semver permits breaking in a minor); the only in-repo consumer is the test, and the migration is trivial (`const { tool } = createCodeMode(...)`), documented in the CHANGELOG. Code Mode is itself a Beta surface. G10 (no silent break): the breaking change is documented with the one-line migration.

**D2 — `instructions` is GENERATED from `config.tools` (DRY / G12).** For each declared tool it renders `await api.<name>(<input>)` + the tool's `description` + the input shape derived from `inputSchema` (top-level properties + types; optional marked `?`). Plus the fixed contract text: the code runs in a sandbox and can call ONLY these functions; `return` ONE structured result; prefer `Promise.all` for independent calls; do arithmetic/aggregation in code. No hand-maintained per-tool prose — the instructions cannot drift from the api surface they describe.

**D3 — Scoping isolation preserved.** Two `createCodeMode` calls generate DISTINCT instructions, each listing ONLY its own `tools` allow-list (Mastra least-privilege). The generator reads only `config.tools`, so an out-of-list tool can never appear.

**D4 — The `tool` is behavior-identical to M29.** The permission gate, the injected-sandbox requirement, the restricted-api assembly, and `tool.handler` are UNCHANGED. Only the function's return shape changes (tool → `{ tool, instructions }`).

## Consequences

- Adds NO runtime, NO sandbox, NO dependency — it derives a prompt string from data already captured. Rung-6 minimal (a pure string generator + a return-shape change).
- Consumers migrate `const tool = createCodeMode(...)` → `const { tool, instructions } = createCodeMode(...)` and add `instructions` to the agent prompt. Documented.
- The instructions render only the INPUT surface (no `outputSchema` exists) — honest; if the SDK later adds `outputSchema` to `CustomTool`, the generator extends.

## Alternatives rejected

- **Additive `.instructions` on the returned tool (non-breaking).** Rejected — semantically wrong (a tool object should not carry the agent's system-prompt text) and diverges from the Mastra `{ tool, instructions }` reference. The pre-1.0 breaking change with a trivial documented migration is cleaner.
- **Bundle a Code-Mode sandbox (Mastra `LocalSandbox`).** Rejected — reaffirmed OUT (ROADMAP § Explicitly out of scope): it contradicts the LOCKED ADR-0041 inject-vetted-only decision (core ships no VM; `node:vm` banned). A host-`node` sandbox default-weakens the boundary.
- **Rename the tool id `run_code` → `execute_typescript` + `external_*` globals.** Rejected — cosmetic churn; the `api.<tool>(args)` object surface is functionally equivalent and is what the generated instructions describe.
