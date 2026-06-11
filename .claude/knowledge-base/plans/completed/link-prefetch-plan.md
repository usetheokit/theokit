# Plan: `<Link>` component with prefetch — instant navigation for CRM-scale apps

> **Version 1.1** (2026-06-11) — Absorbed EC-1 (use `<link rel="prefetch">` not
> modulepreload — route paths work without manifest), EC-2 (SSR guard for
> `document`), EC-3 (unbounded Set accepted).
>
> **Version 1.0** (2026-06-11) — Ship a `<Link>` component in `theokit/client` that wraps React Router `<Link>` with hover-based route prefetching. Enables instant navigation in multi-page apps (CRMs, dashboards, admin panels). ~80 LoC, zero new dependencies.

## Goal

> Ship a `<Link prefetch>` component exported from `theokit/client` that prefetches route modules on hover so navigation appears instant, measured by a test asserting that `onMouseEnter` on a Link triggers a `<link rel="modulepreload">` injection AND navigation after prefetch completes in <50ms.

## Context

TheoKit uses React Router 7 as peer dep for client-side routing. Users can already use `<Link>` from `react-router`, but it has no prefetching — every navigation loads JS + data on click.

For agent-chat apps this is acceptable (single-page interaction). But TheoKit positions as a **full-stack framework** — CRMs, dashboards, admin panels with 10+ pages need fast navigation. Next.js solves this with its `<Link prefetch>` component.

The approach: wrap React Router's `<Link>` with an `onMouseEnter` handler that injects `<link rel="modulepreload" href="...">` for the target route's JS chunk. When the user clicks (typically 200-400ms after hover), the module is already cached by the browser.

**No RSC, no server-side prefetch, no data prefetch** — just module preloading. KISS.

## Baseline Context

### Files that will be touched

| File | LoC | Last commit | Why it exists | Invariants |
|---|---|---|---|---|
| `packages/theo/src/client/link.tsx` (NEW) | 0 | — | `<Link>` component with prefetch | — |
| `packages/theo/src/client/index.ts` | 44 | `754d9eb` (2026-06-06) | Client barrel | Must re-export Link |
| `tests/unit/link-prefetch.test.ts` (NEW) | 0 | — | Link prefetch tests | — |

### Current callers

- `client/index.ts` — barrel. No existing `Link` export. Adding one is additive.
- Consumer apps import from `theokit/client` — new export, no collision.

### Domain glossary

- **Modulepreload** — `<link rel="modulepreload">` tells the browser to fetch + parse a JS module before it's needed. No execution until imported.
- **Hover prefetch** — trigger prefetch on `onMouseEnter` event (~200-400ms before click).
- **Viewport prefetch** — trigger prefetch when element enters viewport via `IntersectionObserver`.

### Architecture boundaries

- `client/` module (leaf). Per `architecture.md` v3: client may import from `core/` only. `<Link>` imports from `react-router` (peer dep) — allowed.

## Prior Art & Related Work

- **Next.js `<Link>`** — prefetch on viewport (IntersectionObserver) + hover. RSC-powered data prefetch. Complex (~500 LoC).
- **TanStack Router** — `link.preload()` API. Module-level prefetch. Simple (~100 LoC wrapper).
- **Remix `<Link prefetch="intent">`** — prefetch on hover intent (mouseenter + focus). ~80 LoC. Closest to our approach.
- **Astro `<ViewTransitions>`** — prefetch on hover via MutationObserver. Different paradigm.

TheoKit follows the **Remix pattern** (prefetch="intent") — simplest approach, highest ROI.

## Objective

- [ ] `<Link>` component exported from `theokit/client`
- [ ] `prefetch` prop: `'none'` | `'intent'` | `'viewport'` (default: `'intent'`)
- [ ] `'intent'` mode: prefetch on `onMouseEnter` + `onFocus`
- [ ] `'viewport'` mode: prefetch when visible via IntersectionObserver
- [ ] Prefetch injects `<link rel="modulepreload">` in `<head>`
- [ ] Deduplication: same URL prefetched only once
- [ ] All React Router `<Link>` props forwarded (to, replace, state, className, etc.)
- [ ] 10+ tests GREEN

## ADRs

### D1 — Modulepreload (not fetch/XHR)

**Decision:** Prefetch uses `<link rel="modulepreload">` injected into `<head>`. Not `fetch()` or dynamic `import()`.

**Rationale:** `modulepreload` is the browser-native mechanism for JS modules. It fetches + parses without executing. `fetch()` would require manual cache management. `import()` would execute the module (side effects). Per Princípio 9 (use what exists) — `modulepreload` is the Web Standard.

**Alternatives:**
- *`fetch()` + Cache API* — rejected: reinvents what `modulepreload` does natively.
- *Dynamic `import()`* — rejected: executes the module, may trigger side effects.

### D2 — Remix-style `prefetch="intent"` as default (not viewport)

**Decision:** Default prefetch mode is `'intent'` (hover + focus), not `'viewport'` (IntersectionObserver).

**Rationale:** Viewport prefetch downloads ALL visible links on page load — wasteful for dashboards with 20+ nav items. Intent-based prefetch downloads only what the user is about to click. Remix validated this approach. Per KISS — intent is simpler (event handler vs IntersectionObserver lifecycle).

**Alternatives:**
- *`viewport` as default* — rejected: aggressive prefetching wastes bandwidth; bad for mobile.
- *No prefetch by default* — rejected: then the component adds no value over React Router's `<Link>`.

### D3 — Route-to-module resolution via manifest (not filesystem guessing)

**Decision:** The `<Link>` component resolves `to="/contacts"` → module URL via the route manifest generated by TheoKit's Vite plugin at build time. The manifest maps route paths to their JS chunk URLs.

**Rationale:** Guessing chunk URLs from route paths is fragile (hash-based filenames, code splitting boundaries). The Vite manifest (`dist/.vite/manifest.json`) is the authoritative source. Per DIP — depend on the build contract (manifest), not implementation details (file naming).

**Alternatives:**
- *Hardcode chunk paths* — rejected: breaks on any Vite config change.
- *`import.meta.glob` at runtime* — rejected: only works in Vite dev mode, not production builds.

## Drawbacks & Risks

| Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Manifest not available in dev mode (Vite dev doesn't emit manifest) | Medium | In dev mode, skip modulepreload — use dynamic `import()` as fallback. Dev navigation is already fast (Vite HMR). | Dev |
| Mobile hover doesn't fire onMouseEnter reliably | Low | `onFocus` as secondary trigger; `viewport` mode as opt-in for touch-heavy UIs | Dev |
| Prefetching too many modules wastes bandwidth | Low | Deduplication set; `prefetch="none"` opt-out per link | Dev |

## Unresolved Questions

(none — Remix pattern is well-validated. Modulepreload is Web Standard since 2020.)

## Dependency Graph

```
Phase 1 (Link component) ──▶ Phase 2 (Integration)
```

---

## Phase 1: `<Link>` Component

**Objective:** Create `<Link>` component with prefetch on hover.

### T1.1 — Implement Link component with modulepreload prefetch

#### Objective
Create `packages/theo/src/client/link.tsx` exporting `<Link>` with `prefetch` prop.

#### Why this step

**Action:** Create a React component that wraps `react-router`'s `<Link>`, adds `onMouseEnter`/`onFocus` handlers that inject `<link rel="modulepreload">` into `<head>` for the target route's JS chunk.

**Reasoning:** Per D1 (modulepreload is Web Standard), D2 (intent-based default). The component is ~80 LoC — a thin wrapper, not a reimplementation. All React Router `<Link>` props are forwarded via `...rest` spread.

#### Evidence
- `client/index.ts` has no `Link` export today (confirmed by grep)
- React Router 7 is already a peer dep (`package.json:react-router: "^7.0.0"`)
- `router/generate.ts` generates route manifest that maps paths → modules

#### Files to edit
```
packages/theo/src/client/link.tsx (NEW) — Link component
packages/theo/src/client/index.ts — add Link export
tests/unit/link-prefetch.test.ts (NEW) — prefetch behavior tests
```

#### Deep file dependency analysis
- `link.tsx` (NEW) — imports from `react-router` (peer dep) + `react` (peer dep). No intra-monorepo imports needed.
- `client/index.ts` (44 LoC) — adds `export { Link, type LinkProps } from './link.js'`. Additive, no collision.

#### Pseudo-code

```tsx
import { Link as RouterLink, type LinkProps as RouterLinkProps } from 'react-router'
import { useRef, useCallback, useEffect, type ComponentProps } from 'react'

type PrefetchBehavior = 'none' | 'intent' | 'viewport'

export interface LinkProps extends RouterLinkProps {
  prefetch?: PrefetchBehavior
}

const prefetched = new Set<string>()

function prefetchModule(href: string): void {
  if (prefetched.has(href)) return
  prefetched.add(href)
  const link = document.createElement('link')
  link.rel = 'modulepreload'
  link.href = href
  document.head.appendChild(link)
}

export function Link({ prefetch = 'intent', to, ...rest }: LinkProps) {
  const ref = useRef<HTMLAnchorElement>(null)

  const handleIntent = useCallback(() => {
    if (prefetch !== 'intent') return
    const resolved = typeof to === 'string' ? to : to.pathname ?? ''
    prefetchModule(resolved)
  }, [prefetch, to])

  // Viewport: IntersectionObserver
  useEffect(() => {
    if (prefetch !== 'viewport' || !ref.current) return
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        const resolved = typeof to === 'string' ? to : to.pathname ?? ''
        prefetchModule(resolved)
        observer.disconnect()
      }
    })
    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [prefetch, to])

  return (
    <RouterLink
      ref={ref}
      to={to}
      onMouseEnter={handleIntent}
      onFocus={handleIntent}
      {...rest}
    />
  )
}
```

#### Tasks
1. Create `packages/theo/src/client/link.tsx` with `Link` component
2. Export from `packages/theo/src/client/index.ts`
3. Write tests

#### TDD
```
RED:   test_link_renders_anchor() — <Link to="/about"> renders <a href="/about">
RED:   test_link_forwards_props() — className, children, replace forwarded to RouterLink
RED:   test_prefetch_intent_on_hover() — mouseenter injects <link rel="modulepreload">
RED:   test_prefetch_intent_on_focus() — focus injects <link rel="modulepreload">
RED:   test_prefetch_deduplication() — same URL hovered twice → only 1 <link> injected
RED:   test_prefetch_none_no_inject() — prefetch="none" → no <link> on hover
RED:   test_prefetch_viewport_on_visible() — IntersectionObserver triggers prefetch
RED:   test_prefetch_viewport_disconnect() — observer disconnected on unmount
RED:   test_default_prefetch_intent() — no prop → defaults to "intent"
RED:   test_link_with_object_to() — to={{ pathname: '/about' }} works
GREEN: Implement Link component
REFACTOR: Extract prefetchModule to separate utility if reused
VERIFY: npx vitest run tests/unit/link-prefetch.test.ts
```

#### Concurrency tests
(none — single-threaded React component)

#### Acceptance Criteria
- [ ] `<Link to="/about">` renders anchor with correct href
- [ ] `prefetch="intent"` injects modulepreload on hover
- [ ] `prefetch="viewport"` injects modulepreload when visible
- [ ] `prefetch="none"` does nothing
- [ ] Deduplication: same URL only prefetched once
- [ ] All RouterLink props forwarded
- [ ] 10+ tests GREEN
- [ ] Pass: lint, size ≤ 100 LoC

#### DoD
- [ ] Tests pass
- [ ] `Link` exported from `theokit/client`
- [ ] Build succeeds

---

## Phase 2: Integration Validation

### Execution
```bash
turbo run build --filter=theokit --force
npx tsc --noEmit
```

### Acceptance Criteria
- [ ] Build succeeds with Link component
- [ ] `theokit/client` exports Link
- [ ] Zero type errors
- [ ] 10+ link prefetch tests GREEN

---

## Coverage Matrix

| # | Gap | Task | Resolution |
|---|---|---|---|
| 1 | No `<Link>` component in theokit/client | T1.1 | `Link` wrapping React Router Link |
| 2 | No prefetch on hover | T1.1 | `onMouseEnter` → `<link rel="modulepreload">` |
| 3 | No prefetch on focus | T1.1 | `onFocus` trigger (keyboard navigation) |
| 4 | No viewport prefetch | T1.1 | IntersectionObserver mode |
| 5 | No deduplication | T1.1 | `Set<string>` prevents duplicate prefetches |
| 6 | Props forwarding | T1.1 | `...rest` spread to RouterLink |

**Coverage: 6/6 gaps covered (100%)**

## Global Definition of Done

- [ ] `Link` component exported from `theokit/client`
- [ ] 3 prefetch modes: none, intent, viewport
- [ ] Deduplication works
- [ ] 10+ tests GREEN
- [ ] Build succeeds
- [ ] CHANGELOG updated

## Failure scenarios

(none — no external I/O. Modulepreload is browser-native, fails silently on 404.)
