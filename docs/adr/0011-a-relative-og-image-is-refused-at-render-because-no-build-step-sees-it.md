# 0011 — A relative `og:image` is refused at render, because no build step sees it

- **Status:** accepted
- **Date:** 2026-09-20
- **Decides:** B-031's second Definition-of-done bullet, which asks for a BUILD failure.

## Context

B-031 asks that "with no base URL configured, a relative `og:image` fails the build by name,
naming the file and the tag". Planning it required deciding whether to build that, and the
measurement says the bullet presumes architecture this framework does not have.

**There is no build step that sees the value.** Measured 2026-09-20:

| query | result |
|---|---|
| `ogImage` across `packages/theo/src/cli/` and `packages/theo/src/vite-plugin/` | **0** |
| `hoistHeadTags(template, ssrHtml)` input | already-rendered SSR markup — request time |

The second row is what closes it. Head hoisting is the only build-adjacent machinery that
touches metadata, and it receives HTML that React has already produced. By the time the tag
exists, the build is over.

One caution on that first number, because the first attempt at it was wrong. An alternation
`metadata|og:|ogImage` reported **14** hits in `hoist-head-tags.ts`, which read as "the build
does see it". Re-run one pattern at a time: `ogImage` 0, `og:` 1, `metadata` 11 — all eleven
being the `metadataKey` function and its docblocks. The count was true and about the wrong
symbol.

**The behaviour the bullet wants already exists, under a different shape.** `cf40254b4` shipped
`refuseRelativeOgImage` (`packages/theo/src/client/metadata.tsx:52`) and six tests
(`tests/unit/metadata-absolute-og-image.test.ts`), green on the repo's own runner: refusal by
name in development, the page still rendering in production, absolute URLs, protocol-relative
URLs, `data:` URIs, and an absent attribute. The code argues the asymmetry in place and cites
this item by id.

## Decision

**The refusal stays at render time, in development only. B-031's second bullet is retired as
written, and no build step is created for it.**

## Rationale

The bullet's intent — *a relative value must not ship silently* — is served. What is not served
is its mechanism, and the mechanism was chosen against architecture that is not there.

Creating a build step to satisfy the wording would mean extracting `<Metadata>` props
statically from route modules, which is a new analysis pass over user code, with its own
failure modes (a prop computed at runtime cannot be extracted, so the pass would refuse what
it cannot see or pass what it cannot read). That is product surface, not a defect fix, and
`rules/parsimony-ladder.md` rung 1 asks whether it needs to exist before rung 6 asks how to
write it.

## Alternatives rejected

**Throw in production as well.** Rejected on the same ground the implementation already
records: it converts a broken social card into a 500 on a page that otherwise renders — a
defect traded for an outage. The card is broken for crawlers; the page is not broken for
people.

**Build a static extraction pass.** Rejected as out of scope for a defect item, per the
envelope's rule that an item is not widened past its recorded scope. If the framework should
own build-time metadata validation, that is a design decision deserving its own item, and it
is adjacent to the base-URL decision already split out as B-222.

**Leave the bullet open.** Rejected because it is unreachable as written, and an unreachable
promise left standing is the fabricated-mechanism defect this repository refuses elsewhere: a
reader counting open DoD bullets would record work that nobody can do.

## Who is affected, and what breaks

`ogImage` is a **published** prop — it appears in `packages/theo/dist/client/index.d.ts`, so
consumers are outside this repository and cannot be enumerated, the same limit ADR 0007
records for its two subpaths. Inside the repository, `ogImage` occurs in exactly four files:
the implementation, that generated declaration, and two tests.

**Nothing breaks.** This decision changes no code and no type. It retires a requirement, which
is visible only to somebody reading B-031 — and the retirement is recorded on the item as well
as here, so neither reader has to find the other.

## Consequences

A relative `og:image` in a production build still ships a broken tag. That is the accepted
cost, and it is bounded: the author sees the refusal in development before it can reach a
build, and the message names the tag and shows the absolute form.
