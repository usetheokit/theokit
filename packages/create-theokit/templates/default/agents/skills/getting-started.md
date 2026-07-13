# Getting started

A **skill** is a Markdown file that documents a repeatable task for your agent — a recipe it (and you) can
follow. Skills live in `agents/skills/` and are plain `.md`, so the route scanner ignores them; reference
them from your instructions or load them into a prompt as your app grows.

This example just documents the scaffold itself:

## Answer a question

1. Read the user's message.
2. If it needs live weather, call the `weather` tool (see `agents/_tools/weather.ts`).
3. Otherwise answer directly, concisely.

## Add a capability

- **A tool** (an action the agent can take) → `agents/_tools/<name>.ts`, then `.tool(<name>Tool)` in
  `agents/chat.ts`.
- **A skill** (a documented procedure) → a new `agents/skills/<name>.md` like this one.
- **The persona / rules** → edit `agents/_lib/instructions.ts`.
