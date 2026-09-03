# Content in this framework: what the scaffold already ships, what this repository does not, and the shape the rest should take

Measured 2026-08-20 against `packages/theo/src`, `packages/agents/src/config/frontmatter.ts` and the
installed `@theokit/ui@1.3.2`. Re-measure before trusting: the 2026-08-19 pass called this a blank
slate, and it is not one. The corrections below say what that pass claimed before saying what is
there.

## Contents

1. [What exists](#what-exists)
2. [Where this framework can be better](#where-this-framework-can-be-better)
3. [The order](#the-order)

---

## What exists

**Correction to the 2026-08-19 measurement.** That pass opened with *"Measured against
`packages/theo/src`: no Markdown, MDX, frontmatter or collection module exists. A blank slate, like
i18n."* The scope makes the sentence technically defensible and practically misleading. Read as
written it is true of that one directory; read as what it was used for — a plan — it is wrong twice,
and the second one is wrong in the expensive direction, because it would have scheduled the building
of something that already ships to every scaffolded project.

* **Frontmatter exists in this repository.** `packages/agents/src/config/frontmatter.ts:34-61` splits a
  markdown file into fenced frontmatter and body, and `packages/agents/src/config/frontmatter.ts:71-81`
  reads one scalar key out of it. It has production callers — the instruction-tree loader
  (`packages/agents/src/config/instruction-tree.ts:303`) and the command template loader
  (`packages/agents/src/config/command-template.ts:5`) — and it is re-exported publicly
  (`packages/agents/src/config-entry.ts:85`). It is scalar-only: no YAML, no nesting, no schema. It
  serves agent instruction files, not content routes. But "no frontmatter module exists" is false, and
  the right statement is that the one that exists is not the one this surface needs.
* **A safe markdown pipeline exists, and it is the scaffold's default.** It lives in `@theokit/ui`,
  whose source is **outside this repository** (`./pnpm-lock.yaml:288-290`), so what follows is measured
  against the installed published artifact, version 1.3.2, and not against source.

| Existing capability | Relevance | Evidence |
|---|---|---|
| Zod as the validation culture | Frontmatter schemas, collection types — the discipline already exists for config, route inputs and generated resources | `packages/theo/src/config/schema.ts:1`, `packages/theo/src/server/http/execute-stages.ts:73`, and 32 files under `packages/theo/src` importing `zod` |
| Route scanner and codegen | Enumerating documents into routes, and generating types for collections | `packages/theo/src/router/scan.ts:128-171`, `packages/theo/src/router/generate.ts:136-150`, `packages/theo/src/cli/commands/generate-types.ts:1-45` |
| The bundler plugin layer | Where compilation and caching hook in | `packages/theo/src/vite-plugin/index.ts:1-68` |
| The `Image` component | Where content images should route — though nothing in this repository renders it yet | `packages/theo/src/client/image.tsx:42`, exported at `packages/theo/src/client/index.ts:77` |
| The `Link` component | Where content links should route; the scaffold does use this one | `packages/theo/src/client/link.tsx:54`, used at `packages/create-theokit/templates/default/src/app/about/page.tsx:40` |
| A scalar frontmatter splitter | Prior art for the fence handling, not for the schema | `packages/agents/src/config/frontmatter.ts:34-61` |
| A markdown-to-JSX pipeline that sanitizes | Ships in `@theokit/ui`; see below | outside this repository — `./pnpm-lock.yaml:288-290` |

### What the `@theokit/ui` pipeline actually does

Measured against the installed artifact (`@theokit/ui@1.3.2`), the order of operations is the correct
one, which is the part worth recording because most hand-rolled pipelines get it wrong:

1. a streaming preprocess pass, so a half-arrived fence renders instead of exploding;
2. `mdast-util-from-markdown` with the GFM extension;
3. `mdast-util-to-hast` with `allowDangerousHtml: false`, so raw HTML never enters the tree;
4. `hast-util-sanitize` over the **tree**, after transformation and before rendering, using
   `defaultSchema` widened only for `className` on `code`/`pre`/`span` and `style` on `span`;
5. `hast-util-to-jsx-runtime` with a component map.

Three limits, each of which is a real gap rather than a nitpick:

* **The component map covers `code` and `pre` and nothing else.** No `a`, no `img`. So a markdown link
  renders as a bare `<a>` with no `rel`, and a markdown image as a bare `<img>` — which is exactly the
  pair M11 names as its Definition of done. The `rel="noopener noreferrer"` that does exist in that
  package is on the source-citation component, not on markdown links.
* **The pipeline is not exported.** Only the `ChatMessage*` components are. There is no
  general-purpose `renderUntrustedMarkdown` an application can call for its own user-supplied content,
  so an application with a comment field still hand-rolls one.
* **It renders inside an effect**, so it is client-only: the server emits nothing for it and the
  markdown appears after hydration.

**Not measured.** Everything in this subsection is read from a published bundle. The sanitize schema,
the component map and the effect boundary were confirmed there; what the package's *source* intends,
whether these are deliberate or incidental, and whether a newer version differs, cannot be established
from this repository. Anyone acting on M11 should confirm against the `@theokit/ui` repository first.

**What is genuinely absent here**: no collection primitive, no frontmatter schema, no content-derived
routes, no MDX, no build caching by content hash, no content build gates. Confirmed by
`command grep -rniE "markdown|remark|rehype|mdx|collection" packages/theo/src`, which returns nothing.

---

## Where this framework can be better

The field's content story is split in two, and both halves are weaker for it: one framework compiles
MDX and leaves collections, schemas and caching to the ecosystem; the ecosystem's content libraries do
collections well and cannot see the router. Four positions are available to a framework that owns both.

### 1. Frontmatter validated by the same schema library as everything else

This codebase validates config, route inputs and generated resources with one library
(`packages/theo/src/config/schema.ts:1`, `packages/theo/src/server/http/execute-stages.ts:73`). Content
is the only untyped input left — and the frontmatter reader it does have parses scalars by hand
(`packages/agents/src/config/frontmatter.ts:71-81`), which is the thing not to repeat. Using the same
schema library for content frontmatter means:

* the same error vocabulary an author already sees elsewhere;
* coercion and defaults from the schema rather than from template code;
* **generated types per collection**, from the same generator that types routes
  (`packages/theo/src/cli/commands/generate-types.ts:1-45`);
* a build failure naming the file and the field — a content error that reads like a compiler error.

No mainstream framework does this with a first-class schema library, because in most of them content is
a plugin and validation is a convention.

### 2. Collections as a routing input, not a separate concept

The route scanner already enumerates the filesystem and already understands groups and dynamic segments
(`packages/theo/src/router/scan.ts:112-126`). A collection is the same operation with a schema
attached, which means a document set can produce routes, sitemap entries, alternates and pre-rendered
pages **through the machinery that already exists**, rather than through a parallel content router. The
static target already walks the route tree to prerender (`packages/theo/src/adapters/static.ts:210-220`).

The incumbents grew a content layer beside the router, so the two have separate configuration, separate
caching and separate mental models. Not having shipped a content layer yet means they can be one thing.

### 3. Finish the untrusted path, rather than start it

This is the correction that changes the plan. The 2026-08-19 pass wrote that *"Almost none ships a safe
pipeline for user-supplied Markdown"* and proposed building one. One already ships in the scaffold's
default UI package, with the sanitize-last ordering and `allowDangerousHtml: false` — the two things
hand-rolled pipelines get wrong. What is missing is narrower and more concrete:

* an element mapping that routes `[]()` through `Link` with `rel="noopener noreferrer"` on external
  origins, and `![]()` through `Image`;
* a protocol allowlist applied to markdown links, not only to source citations — the guard exists in
  that package and is simply not on this path;
* an exported, named entry point so an application can render its own untrusted content;
* server rendering, so the content is in the document rather than appearing after hydration;
* an attack test suite proving all of it.

That is still a differentiator with a security argument, which is the strongest kind. It is just five
gaps in something built, not a build.

### 4. Content build gates

Broken internal links, missing referenced assets, unresolved collection references, duplicate slugs,
skipped heading levels, changed anchors since the last build. All statically checkable, all cheap, none
standard — and none of them runs here today: `theokit check` is typecheck, eslint and the route scan
(`packages/theo/src/cli/commands/check.ts:7-9`).

The anchor-change report in particular is unusual and valuable for public documentation: it turns a
silently broken external link into a decision about a redirect.

---

## The order

1. **Confirm the `@theokit/ui` pipeline against its own source**, and close the element-mapping and
   export gaps there. First, because it is the only item on this list where the work is already
   two-thirds done, and because M11 grades exactly those gaps.
2. **A collection primitive**: a directory plus a schema, with validation failing the build and naming
   the file and field. The foundation, and the item that reuses the most existing culture.
3. **Generated types per collection**, from the existing generator.
4. **Plain Markdown rendering** with the element mapping — headings with stable anchors, links through
   the framework's `Link`, images through `Image`, tables wrapped. No MDX yet. Shares the element
   mapping with step 1 rather than duplicating it.
5. **A named untrusted entry point**, server-renderable, with the allowlist, tree sanitisation last,
   and an attack test suite. Early, because applications need it before they need MDX.
6. **Build caching by content hash**, before the archive grows. Cheap now; a rewrite once templates
   depend on a slow pipeline.
7. **Content build gates**: links, assets, references, duplicate slugs, heading outlines.
8. **Directives**, with an application-controlled component allowlist — the rung that covers callouts
   and embeds without executable documents.
9. **MDX**, last and explicitly for trusted, repository-authored content, with the trust boundary
   written into the API's name and documentation.
10. **Build-time syntax highlighting** with line-level features. Note that the scaffold already reaches
    a highlighter through the UI package's code component, so this is about repository-authored content
    at build time, not about chat.
11. **Anchor-change reporting** between builds.

The ordering is deliberate: MDX is the feature everyone asks for first and the one that should ship
last, because everything before it is what makes MDX safe to add rather than the thing every content
need gets routed through.
