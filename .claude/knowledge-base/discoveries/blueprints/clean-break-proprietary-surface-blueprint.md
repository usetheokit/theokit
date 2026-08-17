# Blueprint: Clean break — remove the proprietary agent surface (M3 — Eixo B tail)

> **Exec summary.** M3 deletes the pre-M2 proprietary agent surface **entirely** (hard break,
> no compat layer, per the Q5 lock "virada total"). The surface is the `AgentEvent`
> discriminated union (`packages/theo/src/core/contracts/agent-events.ts`) + its server
> producers (`stream-agent-run.ts`, `define-agent-endpoint.ts`, `create-conversation-history.ts`,
> `agent-types.ts`) + its client cluster (`use-agent-stream.ts`, `agent-stream-core.ts`,
> `agent-tool-cards.ts`, `use-agent-tool-cards.ts`). All of it is **superseded by M2** — the
> `agents/*.ts` convention (`defineAgent` → `mountAgent` → `translateToUIMessageStream`) +
> the client `useAgent`/`consumeUIMessageStream` — which is **verified 100% independent** of
> the removed code (M2's `mount-agent.ts` / `@theokit/agents` `agent-endpoint.ts` import NONE
> of the removal set; the SDK owns conversation storage, so theo's `createConversationHistory`
> has no surviving caller). The DoD gate is `grep -r "AgentEvent\|useAgentStream" packages/*/src`
> → **0** (currently 11 files, incl. 3 comment-only refs in surviving files). This is a BREAKING
> change → `theokit` **major** (0.13.0 → 0.14.0) + `@theokit/agents` unaffected (the surface
> lives in `theokit`, not `@theokit/agents`).
>
> **Verdict: (to be scored by /discover-confidence)**

### Scope reminder (LOCKED)

- **In scope:** delete the proprietary surface; migrate the default template + its fixture to
  `agents/chat.ts` + `useAgent`; delete the two demo fixtures; delete/migrate the 25 tests;
  publish a migration guide; CHANGELOG BREAKING/Removed; the grep→0 gate.
- **Out (YAGNI/next):** M4 harness (adapter over SDK). No new features — M3 is pure removal +
  migration.

---

## Coverage Corner 1 — Integration Tests

*(What proves the break is clean + the template still works.)*

- **The grep→0 gate** is the primary integration proof (DoD line 1). A test asserts
  `grep -rE "AgentEvent|useAgentStream" packages/*/src` returns zero (add to a structural test,
  mirroring `tests/unit/architecture-guards-ci.test.ts`).
- **The default template E2E** must stay green on the M2 surface. Today `tests/e2e/template-default*.spec.ts`
  + `tests/unit/fixture-template-default-canonical-chat.test.ts` assert `useAgentStream` +
  `defineAgentEndpoint`; they migrate to assert `agents/chat.ts` `export default defineAgent`
  + `useAgent('chat')`. The M2 exemplar is `tests/integration/unified-agent-surface.test.ts`
  (real `agents/echo.ts` → `mountAgent` → ai `readUIMessageStream`).
- **Dead-code gate** (`/code-quality` D1 knip): after removal, no orphan export may remain
  (ROADMAP risk 2 — the client tool-cards must not survive as orphans). The audit must be clean.

### Test disposition (25 files)

| Fate | Tests |
|---|---|
| **DELETE** (test removed code) | `use-agent-stream.test.ts`, `define-agent-endpoint.test.ts`, `define-agent-endpoint-params.test.ts`, `regression-1/2-define-agent-endpoint-*.test.ts`, `stream-agent-run.test.ts`, `stream-agent-run-error-discrim.test.ts`, `stream-agent-run.test-d.ts`, `agent-stream-derivations.test.ts`, `agent-event-type.test-d.ts`, `tests/type/agent-thinking-event.test-d.ts`, `create-conversation-history.test.ts`, `create-conversation-history.test-d.ts`, `create-conversation-history-storage.test.ts`, `define-agent-endpoint-signal.test.ts`, `fixture-agent-endpoint.test.ts`, `fixture-use-agent-stream-react.test.ts` |
| **MIGRATE** (rewrite for M2) | `fixture-template-default-canonical-chat.test.ts`, `template-default.spec.ts`, `template-default-canonical-chat.spec.ts`, `scaffold-default-agent.test.ts`, `create-theo-default-template.test.ts`, `create-theokit-bare.test.ts`, `scaffold-no-openai-anti-stack.test.ts` |
| **VERIFY-only** (may reference in a boundary rule) | `architecture-guards-ci.test.ts` |

---

## Coverage Corner 2 — Dependencies

- **No new dependency** — M3 is removal + migration. `ai` (M2 consumer) already present.
- **Cross-package:** the surface lives entirely in `theokit` (`packages/theo`). `@theokit/agents`
  is NOT touched (it holds `defineAgent`/`createSdkAgentStream`, the replacement). So the bump
  is `theokit` **major** only.
- **`provider-resolver.ts` SURVIVES** — shared by the removed `createConversationHistory` AND
  M2's `mount-agent.ts`. Deleting `createConversationHistory` must NOT touch `provider-resolver`.
- **`define-agent-tool.ts` SURVIVES** — a pure Zod→SDK `CustomTool` adapter, independent of
  `AgentEvent` (only a comment references it). It stays in `theokit/server/define`.

---

## Coverage Corner 3 — Tools

- **`git rm`** for the deleted files (8 src + 2 fixtures + ~16 tests).
- **grep gate** (`grep -rE`) — the DoD proof, wired into a structural test.
- **knip** (`/code-quality` D1) — orphan-export detection after removal.
- **`pnpm sync:templates`** (`scripts/sync-template-versions.mjs`) — syncs template↔fixture
  VERSIONS only (content is a separate copy); the template migration must be applied to BOTH
  `packages/create-theokit/templates/default/` AND `fixtures/template-default/`.
- **tsc + vitest + eslint** — the standard gates; deleting exports must leave 0 type errors
  (every importer migrated) and 0 dead code.

---

## Coverage Corner 4 — Techniques

### The removal boundary (LOCKED remove / survive / clean lists)

**REMOVE (delete the file):**
- `packages/theo/src/core/contracts/agent-events.ts` — the `AgentEvent` union + `errorToEvent`.
- `packages/theo/src/server/agent/stream-agent-run.ts` — the proprietary SSE producer.
- `packages/theo/src/server/agent/create-conversation-history.ts` — theo's conversation lifecycle (SDK owns this in M2; no surviving caller).
- `packages/theo/src/server/agent/agent-types.ts` — the back-compat re-export barrel.
- `packages/theo/src/server/define/define-agent-endpoint.ts` — the imperative SSE endpoint.
- `packages/theo/src/client/use-agent-stream.ts` — the proprietary hook + `deriveLiveText`/`deriveError`.
- `packages/theo/src/client/agent-stream-core.ts` — the old `AgentEvent` SSE parser.
- `packages/theo/src/client/agent-tool-cards.ts` + `use-agent-tool-cards.ts` — the tool-card correlator + hook (ROADMAP risk 2: must not orphan).

**CLEAN (surviving file — remove the export line / comment):**
- `packages/theo/src/client/index.ts` — drop the barrel exports for the removed client cluster + the `AgentEvent` re-export (lines ~20-37,55-66).
- `packages/theo/src/core/contracts/index.ts` — drop the `agent-events` re-export (lines ~12-20).
- `packages/theo/src/server/agent/index.ts` — drop `stream-agent-run` + `create-conversation-history` + `agent-types` re-exports; keep whatever survives (`provider-resolver`? none-public → the subpath may collapse).
- `packages/theo/src/server/define/index.ts` — drop `defineAgentEndpoint`; keep `defineAgentTool`.
- `packages/theo/src/client/use-agent.ts:15` — a COMMENT ("mirrors `useAgentStream`") → reword (DoD grep counts comments).
- `packages/theo/src/server/define/define-agent-tool.ts:17` — a COMMENT ("error `AgentEvent` on the SSE wire") → reword.
- `packages/create-theokit/src/bare-transform.ts:82` — a COMMENT ("depends on AgentEvent type") → reword.

**SURVIVE (untouched):** `mount-agent.ts`, `agent-endpoint.ts` (`@theokit/agents`), `use-agent.ts`,
`consume-ui-message-stream.ts`, `provider-resolver.ts`, `define-agent-tool.ts`,
`ui-message-stream-response.ts`, `configure-agent-registry.ts`.

### Public export surface (BREAKING — the major-bump justification)

- `theokit/client` loses: `useAgentStream`, `deriveError`, `deriveLiveText`, `consumeAgentStream`,
  `parseSSEChunk`, `useAgentToolCards`, `foldAgentToolCards`, `defaultResolveEnvelope`,
  `AgentToolCard`, `UseAgentStreamReturn/Options`, `AgentStreamStatus`, `ConsumeOptions`,
  `AgentEvent` (+ variants). Keeps: `useAgent`, `consumeUIMessageStream` (M2).
- `theokit/server/define` loses: `defineAgentEndpoint`. Keeps: `defineAgentTool` + others.
- `theokit/server/agent` loses: `streamAgentRun`, `createConversationHistory`, `AgentEvent`
  re-exports. If nothing public survives, the `./server/agent` subpath export in
  `package.json` is removed (also breaking — acceptable in a major).
- `theokit/core/contracts` loses the `AgentEvent` re-export.

### The migration guide (DoD line 2)

Lands at `docs/migration/0.13-to-0.14-agent-surface.md` (mirrors the existing
`docs/migration/0.2-to-0.3.md` precedent). Covers:
1. **`useAgentStream('/api/agent')` → `useAgent('chat')`** — before/after; `events: AgentEvent[]`
   becomes `messages: UIMessage[]` (ai-sdk standard); `send(body)` typed from the agent schema.
2. **`defineAgentEndpoint` (in `server/routes/*.ts`) → `defineAgent` (in `agents/*.ts`)** —
   before/after; the route is auto-mounted (no manual `export const POST`).
3. **Wire format:** proprietary `AgentEvent` SSE → `UIMessageStream` (`x-vercel-ai-ui-message-stream: v1`);
   non-React/non-JS clients read it with any ai-sdk-compatible reader.
4. **Removed exports table** (client + server) with the M2 replacement for each.
5. **Downstream note:** `@theokit/ui` consumers of `AgentEvent` migrate to `UIMessage` (separate repo).

---

## ADRs

### ADR-C1 — Hard removal, no deprecation window (clean break)

- **Context.** Q5 locked "virada total, sem retrocompatibilidade". M2 shipped the full
  replacement (`agents/*.ts` + `useAgent`, published `theokit@0.13.0`). Keeping a compat shim
  (e.g. `defineAgentEndpoint` re-exporting the M2 path) would (a) keep the proprietary `AgentEvent`
  wire alive, defeating the grep→0 DoD, and (b) carry two surfaces forever.
- **Decision.** Delete the surface outright in `theokit@0.14.0` (major). No `@deprecated` window.
  A migration guide + BREAKING CHANGELOG is the mitigation (ROADMAP risk 1 — pre-1.0 beta makes
  a hard break acceptable).
- **Alternatives.** (a) Deprecation window → contradicts Q5 + the grep→0 gate. (b) Codemod-only
  (keep runtime) → the runtime is what must die. Rejected.
- **Consequence.** `theokit` majors to 0.14.0; downstream apps (dogfood TheoCode, `@theokit/ui`)
  migrate via the guide.

### ADR-C2 — `AgentEvent` deleted, not kept as an internal wire contract

- **Context.** One might keep `AgentEvent` as an internal type (some frameworks keep a private
  wire contract). But the M2 wire is `UIMessageChunk` (ai-sdk), and nothing surviving consumes
  `AgentEvent`.
- **Decision.** Delete `agent-events.ts` entirely — the DoD grep→0 is literal (`packages/*/src`
  returns 0, comments included). The type-tests for the contract (`agent-event-type.test-d.ts`,
  `agent-thinking-event.test-d.ts`) are deleted with it.
- **Consequence.** Zero `AgentEvent` in the repo; the only agent wire is `UIMessageStream`.

---

## Edge cases (settled)

- **EC-1 — `createConversationHistory` removal safety.** Verified: M2's `mount-agent.ts` →
  `streamAgentUIMessages` → `createSdkAgentStream(compiled, tools, apiKey)(message, sessionId)`
  passes `sessionId` to the SDK, which owns conversation storage (`InMemoryConversationStorage`).
  theo's `createConversationHistory` has NO surviving caller → safe to delete. Its storage test
  (`create-conversation-history-storage.test.ts`) deletes with it.
- **EC-2 — `provider-resolver.ts` must NOT be deleted.** It's imported by BOTH the removed
  `create-conversation-history.ts` AND M2's `mount-agent.ts`. Deleting the former must leave
  `provider-resolver.ts` + its test intact.
- **EC-3 — comment-only refs count toward grep→0.** `use-agent.ts:15`, `define-agent-tool.ts:17`,
  `bare-transform.ts:82` reference `AgentEvent`/`useAgentStream` in prose only — but the DoD grep
  is literal; reword them. (Do NOT delete those surviving files.)
- **EC-4 — `./server/agent` subpath export.** After removing stream-agent-run +
  create-conversation-history + agent-types, check what remains public. If nothing, remove the
  `./server/agent` export from `package.json` (breaking, fine in a major) AND any importer of it.
  If `configure-agent-registry`/`provider-resolver` are meant to stay public, keep the subpath
  with only those.
- **EC-5 — template ↔ fixture dual-copy.** The default template lives in
  `packages/create-theokit/templates/default/` AND is mirrored in `fixtures/template-default/`.
  The `agents/chat.ts` migration + `app/page.tsx` `useAgent` rewrite must be applied to BOTH,
  and the skill docs (`dot-claude/skills/theokit-{agents,frontend,ui}/SKILL.md`) updated to drop
  the old surface.
- **EC-6 — deleted-fixture tests.** Deleting `fixtures/use-agent-stream-react/` +
  `fixtures/agent-endpoint-mock/` requires deleting their tests
  (`fixture-use-agent-stream-react.test.ts`, `fixture-agent-endpoint.test.ts`,
  `define-agent-endpoint-signal.test.ts`) AND removing the dirs from `fixtures/README.md` +
  the `fixtures-index.test.ts` list (which already fails on a stale entry — fix in passing).
- **EC-7 — dead-code after removal (ROADMAP risk 2).** The client tool-cards
  (`agent-tool-cards.ts` + `use-agent-tool-cards.ts`) must be DELETED, not left as orphan
  exports. The `/code-quality` D1 knip gate must be clean post-removal (no orphan export).

---

## References

- M3 DoD: `ROADMAP.md` § M3
- M2 replacement surface: `.claude/knowledge-base/adrs/0037-unified-agent-surface-defineagent-vs-agent-decorator.md`, `tests/integration/unified-agent-surface.test.ts`
- Removal targets (server): `packages/theo/src/core/contracts/agent-events.ts`, `packages/theo/src/server/agent/{stream-agent-run,create-conversation-history,agent-types}.ts`, `packages/theo/src/server/define/define-agent-endpoint.ts`
- Removal targets (client): `packages/theo/src/client/{use-agent-stream,agent-stream-core,agent-tool-cards,use-agent-tool-cards}.ts`
- Survive: `packages/theo/src/server/agent/provider-resolver.ts`, `packages/theo/src/server/define/define-agent-tool.ts`, `packages/theo/src/client/{use-agent,consume-ui-message-stream}.ts`
- Migration precedent: `docs/migration/0.2-to-0.3.md`
- Template: `packages/create-theokit/templates/default/`, `fixtures/template-default/`
