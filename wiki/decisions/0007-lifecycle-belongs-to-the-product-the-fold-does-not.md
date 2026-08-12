# ADR 0007: lifecycle events belong to the product; the fold that produces them does not

**Status:** accepted · 2026-08-11 · B-123

## The question

`@theokit/presenter` ships one canonical event (`AgentOutputEvent`) and three surfaces that render
it: JSON, terminal, and a UI message stream. A consumer speaking the Codex JSONL dialect cannot use
any of them, and builds its own emitter instead — 181 lines in the one measured example
(`TheoCode/packages/cli/src/runtime/events.ts`).

So: does the presenter grow a lifecycle event set alongside `AgentOutputEvent`?

## What the measurement showed

The two vocabularies are not two spellings of one thing. They are on different axes.

| | events |
|---|---|
| `AgentOutputEvent` | `text`, `reasoning`, `tool-call`, `partial-tool-call`, `tool-result`, `error`, `finish`, `status` |
| the Codex wire contract | `thread.started`, `turn.started`, `item.started`, `item.completed`, `turn.completed`, `turn.failed` |

The canonical event is **content**-shaped: *this chunk is text, this one is a tool call*. The wire
contract is **lifecycle**-shaped: *a thread has turns, a turn has items, a turn ends once with usage
aggregated across it*. `JsonPresenter` is 40 lines that namespace the discriminant and pass the
payload through — correct for what it models, and structurally unable to model the other axis.

Reading the consumer's emitter shows what actually sits between them. It is a **state machine**:
it holds accumulated text, an `errorSeen` flag, an item counter and a usage block; it opens a thread
and a turn on construction; it maps content chunks to item events; and on finish it flushes the
accumulated text as one item and closes the turn exactly once, as completed **or** failed.

## Decision

**The lifecycle vocabulary belongs to the product. The fold that produces it does not.**

Concretely:

1. The presenter does **not** gain a `thread.started` / `turn.completed` event set. Those names, the
   Codex JSON shape, the usage field names and the chunk-to-item mapping are one wire contract among
   several — ACP and the OpenAI-style dialects name the same moments differently — and a framework
   that picks one has picked a side.

2. `AgentOutputEvent` is **not** reshaped to carry lifecycle. Two axes, two vocabularies; widening
   the content event to hold turn state would make every consumer of the content axis pay for it.

3. What IS framework-shaped, and is the follow-on work this ADR sanctions, is the **fold**: a
   reducer from a content-event stream to a caller-supplied lifecycle vocabulary, carrying the one
   invariant a hand-rolled emitter gets wrong — **a turn opens exactly once and closes exactly once,
   never both completed and failed, and never left open when the stream ends.**

## Why not simply publish the Codex event set

Because it is the mistake this ecosystem already made once and recorded. B-104 deferred a keypress
router on exactly this ground — *designing a public API against a single consumer is how a framework
acquires an interface its second consumer routes around* — and its resolution was to publish the
ORDERING RULE with the vocabulary as type parameters, naming no key and no mode. The same shape
applies here: publish the state machine, keep the words with whoever owns the wire.

## Consequences

- The measured consumer keeps its 181 lines for now. The LoC delta B-123's second bullet asks for is
  recorded when the fold ships, not estimated from file size — the same discipline B-103 was killed
  for violating, where "~430 LoC could be returned" turned out to be derived from file sizes rather
  than from capability.
- A second consumer speaking a different dialect is what will confirm the fold's shape. Until one
  exists, the reducer's interface is designed against a single example and should be reviewed as
  such.
- This ADR closes B-123's first and third bullets. The second stays open, and the item stays open
  with it.
