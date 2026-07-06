# Example — code assistant

A code assistant built on TheoKit in two small agent files. It **reads your repo, greps it, and
proposes edits** — streaming its work into the chat UI and pausing for your approval before it writes
a file. This is the runnable companion to the guide
[`docs/guides/build-a-code-assistant.md`](../../docs/guides/build-a-code-assistant.md).

## The two agents

| File | What it is | Surface |
|---|---|---|
| [`agents/assistant.ts`](./agents/assistant.ts) | **Read-only assistant** — reuses `@theokit/sdk-tools` (`read_file` / `list_dir` / `search_text` / `glob`, each gated to `projectRoot`) + one custom `defineAgentTool` (`count_lines`). Auto-served at `POST /api/agents/assistant`. | functional (`defineAgent`) |
| [`agents/coder.ts`](./agents/coder.ts) | **Writer with a human gate** — a `@HumanInTheLoop`-gated `write_file`, `@Checkpoint` (resume), and a bounded `@MainLoop`. Auto-served at `POST /api/agents/coder`. | class (`@Agent`) |

The chat UI is the default `create-theokit` `app/page.tsx` (renders text + tool-call cards via
`@theokit/ui@1.0.0`) — nothing to change.

## Run it

This example is a drop-in for a scaffolded app. From a fresh scaffold:

```bash
npm create theokit@latest my-assistant
cd my-assistant
pnpm add @theokit/sdk-tools
pnpm add -D @types/node
# copy examples/code-assistant/agents/{assistant,coder}.ts into your agents/
echo "OPENROUTER_API_KEY=sk-or-v1-..." > .env
pnpm dev
```

Then ask the assistant *"where do we define the HTTP client, and who imports it?"* — it greps,
reads, and answers with real paths, each tool call rendered as a card. Ask the coder to write a file
and it pauses for your approval first.

## Why it's small

A grounded code assistant — file read/list/search/glob + a human-gated writer — is **2 files, 72
lines of code** (37 in `assistant.ts`, 35 in `coder.ts`), because the file/search/shell layer is
reused from `@theokit/sdk-tools` (don't reinvent) and the runtime is `@theokit/sdk` (the harness is
an adapter, not a second loop).

## Verified

`tsc --noEmit` = **0 errors** and `theokit build` = **0** on the published packages
(`create-theokit@1.0.17` · `theokit@0.15.2` · `@theokit/agents@0.30.2` · `@theokit/sdk-tools@0.8.0`).
The live model round-trip needs your provider key (`.env`).
