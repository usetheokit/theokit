# 0016 — The framework does not own a base URL, so a relative `og:image` is refused rather than resolved

- **Status:** accepted
- **Date:** 2026-09-21
- **Decides:** B-222, which is B-031's FIRST Definition-of-done bullet, split out on 2026-09-20.
- **Sibling:** ADR 0011 retired B-031's second bullet on the same kind of argument. This one
  completes the pair.

## Context

B-031's first bullet reads *"with a base URL configured, the served document carries an absolute
`og:image`"*. The condition is the problem: **there is no base URL to configure.**

Measured 2026-09-21, re-running the query B-222 recorded:

| query | result |
|---|---|
| `baseUrl\|siteUrl\|canonicalUrl\|publicUrl\|origin` across `packages/theo/src/config/*.ts` | **0** |
| `request.url\|new URL(…req` across `packages/theo/src/client/*.tsx` | **0** |

The second row is the one that decides it. `Metadata` is a client component; it renders with props
and nothing else. There is no request in scope at the moment the tag is written — not at build
time, because ADR 0011 already established no build step sees the value, and not at render time,
because the component has no access to the request that would carry the origin.

**Two existing keys look like a base URL and are not.** `schema.ts:114` declares `port` and
`schema.ts:124` declares `host`. They describe where the **dev server binds**. Binding `0.0.0.0:3000`
says nothing about `https://myapp.example`, and reading them as a public origin would produce an
absolute URL that is wrong on every deployment — the exact failure mode the refusal exists to catch,
arriving with the framework's signature on it.

**And one caution on the query, because ADR 0011 recorded the same trap one bullet over.** Grepping
`baseUrl` across `docs/` returns **5** hits, which reads as "a base URL exists". Every one of them is
an **LLM provider's API endpoint** — `baseUrl: "http://localhost:11434"` for Ollama,
`https://api.openai.com/v1` for OpenAI. Same word, unrelated concept: where a model is reached, not
where this app is published. The count was true and about the wrong symbol, exactly as it was for
`metadata` in 0011.

## Decision

**The framework does not own a base URL. B-031's first bullet is retired, and `refuseRelativeOgImage`
stays the whole of the behaviour.**

An author writing `ogImage="/card.png"` gets a development-time error that spells out the fix:

```
ogImage="https://your-domain.example/card.png"
```

That is the entire remedy the resolution would have automated.

## Who this affects, and what does NOT break

Every consumer of `<Metadata>` — the one public surface involved. **Nothing breaks**: this decision
adds no key, removes no key, and changes no rendered output. It is a decision NOT to grow the
public surface, so it is additive-compatible in both directions and reversible by a later ADR that
adds the key. The opposite decision is the one that is hard to withdraw: a config key, once
published, is a promise every app then depends on.

## Alternatives rejected

**1 — Add a `baseUrl` config key and resolve against it.** The friendlier behaviour, and the reason
it is rejected is that it trades a *visible* failure for an *invisible* one. A relative value today
throws in development, in front of the author, at the moment they wrote it. Resolved against a
stale or environment-wrong base URL it produces a well-formed absolute URL that passes every check
and is wrong — and it is wrong for the crawler, which is the reader nobody tests with. A preview
deploy, a custom domain and a local dev server are three origins for one build; any single
configured value is wrong in at least two of them.

**2 — Derive the origin from the incoming request at SSR.** Refuted by measurement, not by
preference: the client component has no request in scope (row 2 above), and the same component
renders on the client where no request exists at all. Threading one in would change `Metadata`'s
signature for every consumer to fix one prop.

**3 — Reuse `host` and `port`.** Rejected above: they are the dev server's bind address. This is
worth stating rather than leaving implicit, because they are the keys a future reader will find
first and they look like the answer.

**4 — Refuse at build time instead.** Already decided, and already rejected, by ADR 0011. No build
step sees the value.

## The scope this deliberately leaves open

`props.canonical` (`metadata.tsx:100`) is rendered unchecked and has exactly the same shape: an
absolute URL the author must supply, with no framework-side resolution. **This ADR does not extend
the refusal to it**, and says so rather than leaving a reader to wonder whether the omission was
noticed. Whether `canonical` deserves the same development-time refusal is a separate question with
its own evidence, and it is registered rather than decided here.
