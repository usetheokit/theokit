# Dogfood Manifest — TheoKit

The single source of truth for TheoKit's dogfood anchor. Read by `/dogfood` alongside
`rules/dogfood-golden-rule.md`. Evidence lives in `evidence/`.

## Anchor — agent chat on the new surface

**Slug:** `agent-chat-new-surface`

**Status:** `running`

**Description:** `npx create-theokit my-app` → `pnpm install` → `theokit dev` → an agent on the
`agents/<name>.ts` surface streams a real model response AND executes a real tool call, over the
ai-sdk `UIMessageStream` wire, driven end-to-end against a real LLM provider (OpenRouter) on the
maintainer's own machine. Not a stubbed SDK.

**Why running:** Exercised end-to-end on 2026-07-05 during the M6 dogfood — a freshly scaffolded app
streamed a real chat and ran a real `add` tool call (`137 + 456 → 593`) against `openai/gpt-4o-mini`
via OpenRouter. The run surfaced (and fixed) two real v1 bugs before the ship. See `evidence/`.

**Honest caveat:** the **chat** leg is reproducible today on the published `theokit@0.15.0` /
`@theokit/agents@0.30.0`. The **tool-call** leg used the FIXED build (via `pnpm.overrides` to the M6
build) because the published `@theokit/agents@0.30.0` still carries the pre-fix adapter — a fresh
end-user `npx create-theokit` reproduces the tool leg only after the `theokit@0.15.1` /
`@theokit/agents@0.30.1` release publishes (the template's caret ranges pick it up automatically).

## Target dates

- Wired: 2026-07-04 (M2 shipped the `agents/*.ts` surface; deterministic E2E green).
- Running: 2026-07-05 (M6 live dogfood — real streamed chat + tool call on a fresh scaffold).
