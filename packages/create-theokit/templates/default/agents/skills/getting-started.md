# Getting started

A **skill** is a Markdown file that documents a repeatable task for your agent — a recipe it (and you) can
follow. Skills live in the agent's `skills/` folder and are plain `.md`; reference them from your prompt or
load them into context as your app grows.

This example documents the scaffold itself:

## Answer a question

1. Read the user's message.
2. If it needs live weather, call the `weather` tool (see `../tools/weather.ts`).
3. Otherwise answer directly, concisely.

## Add a capability to this agent

- **A tool** (an action the agent can take) → `agents/tools/<name>.ts`, then `.tool(<name>Tool)` in
  `agents/chat.ts`.
- **A skill** (a documented procedure) → a new `agents/skills/<name>.md` like this one.
- **The persona / rules** → edit `agents/prompts/instructions.ts`.
- **A whole new agent** → a new folder `agents/<name>/index.ts` → served at `/api/agents/<name>`.
