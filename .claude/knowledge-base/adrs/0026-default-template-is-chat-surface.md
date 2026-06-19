# ADR 0026 — The default template is the agent chat-surface (not decorator-REST)

**Status:** Accepted
**Date:** 2026-06-17
**Deciders:** project owner

## Context

The repo shipped a **decorator-based** default template (`@Controller`/`@Toolbox`
REST app with Drizzle/SQLite) in `create-theokit` v1.0.14, while a large set of
tests (`create-theokit-bare`, `create-theo-default-template`,
`scaffold-no-openai-anti-stack`, plus `bare-transform.ts`) encoded a **chat-surface
`@theokit/ui`** default (AgentComposer + streaming `chat.ts` + `@theokit/sdk`).
The two were irreconcilable — the test suite contradicted itself about what the
default template *is*, so "all tests green" was impossible without choosing one
identity.

## Decision

**The default template is the agent chat-surface.** Rationale: the product's
"wow moment" — *Build the app your agent lives in* — is the developer running
`npm create theokit && npm run dev` and immediately seeing their agent talking
in a real chat UI. A decorator-REST scaffold shows backend plumbing, not that
aha. The chat-surface is the canonical first impression; `--bare` remains the
minimal "Hello Theo" escape hatch (no UI, no unpublished registry deps).

Concretely:

- Reshaped `packages/create-theokit/templates/default` to the chat-surface
  (mirrors the canonical `fixtures/template-default`): `app/page.tsx`
  (`@theokit/ui` ChatThread/ChatComposer/…), `server/routes/chat.ts` (streaming
  agent endpoint, `createConversationHistory` + `streamAgentRun` +
  `defineAgentTool`), Tailwind toolchain, `@theokit/ui` + `@theokit/sdk` +
  `lucide-react` deps. Kept `server/routes/health.ts`, `public/*`, `_gitignore`.
- Removed the decorator scaffolding (`app.ts`, `server/{controllers,toolboxes,guards,interceptors,filters,middleware,agents,db,store.ts,index.ts}`, `tests/tasks.test.ts`, `drizzle.config.ts`, `globals.css`).
- Repointed the chat-surface tests from the dead `create-theo/templates/default` path to `create-theokit/templates/default`.
- Removed the decorator-default e2e (`tests/e2e/scaffold-to-request.test.ts`) — it asserted the now-retired controllers/toolboxes scaffold.
- `--bare` (`bare-transform.ts`) is unchanged: it strips the UI/SDK/tailwind and ships "Hello Theo".

## Alternatives considered

1. **Keep decorator-REST default (rejected).** Zero change to the published template, but loses the agent-chat wow moment and would require deleting the chat-surface tests + `bare-transform` machinery — discarding the more valuable first-run experience.
2. **Ship both (rejected).** A decorator default + a separate chat variant doubles the template surface and contradicts the default-only convergence (ADR 0023).

## Consequences

- `create-theokit my-app` scaffolds an agent chat app; `--bare` gives the minimal scaffold.
- `create-theokit-bare`, `create-theo-default-template`, `scaffold-no-openai-anti-stack`, `create-theo-scaffold` are green against the chat-surface default.
- The decorator e2e is removed; the template's `CLAUDE.md`/`dot-claude` skills still describe the old decorator app and need a coherence follow-up (not test-gated).
- This is a **published-template change** to `create-theokit` and ships in the next release.

## References

- Canonical chat-surface reference: `fixtures/template-default` (restored earlier this cycle).
- Default-only template set: ADR 0023. Stale-cleanup root cause: ADR 0024.
