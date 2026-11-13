# 0036: Terminal commands have aliases and hidden names

- Status: Accepted
- Date: 2026-11-13

## Context

The `./commands` docblock deferred aliases, help rendering and completions until there was demand
(Top-risk 1 of the M83 milestone). TheoCode is that demand. Its TUI keeps four parallel tables for
about 45 names (palette, exact names, names with an argument, definitions) plus a handler record.
`/exit` is a second palette entry and a second table row for `/quit`, and about 40 Codex names answer
but are not shown. Its definitions carry an empty description and an optional argument, so the
`missing-argument` and `unexpected-argument` errors can never fire.

## Decision

`CommandDefinition` gains optional `aliases`, `hidden` and `run`. `createCommandRegistry` builds one
registry from one list: `palette()` (visible canonical names, in order), `route()` (aliases resolve
to the canonical definition) and `dispatch()` (routes, then calls `run`). A name or alias claimed
twice throws `CommandRegistryError` at creation, instead of `ambiguous-command` at the first
keystroke. `routeCommand` keeps its signature and resolves aliases too.

Help rendering and completions stay out, and so does argument parsing for process launch (ADR 0042
reasoning in the `commands/index.ts` docblock). Command names and wording stay in the product.

## Consequences

The change is additive; existing `routeCommand` callers are unaffected. TheoCode migrates in a
separate issue.
