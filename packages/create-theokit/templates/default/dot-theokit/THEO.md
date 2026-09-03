# Project context

Everything in this file is prepended to the agent's context on **every** turn. It is the place for
facts that are true regardless of what the user asks — not instructions about tone, which belong in
a personality, and not rules about specific files, which belong in `rules/`.

Keep it short. It costs tokens on every single turn, so a paragraph nobody reads is a paragraph
everybody pays for.

## What this app is

Replace this with two or three sentences about your product: what it does, who uses it, and the one
thing an agent should never get wrong about it.

## Vocabulary

Define the words your domain uses differently from everyone else. This is the highest-value thing
you can put here — a model that guesses what "account" means in your system will guess wrong in a
way that reads as fluent.

| Term   | In this app it means                     |
| ------ | ---------------------------------------- |
| _term_ | _the definition your team actually uses_ |
