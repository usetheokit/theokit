# Plan: SEO & Media — Metadata helper + `<Image>` component

> **Version 1.0** (2026-06-11) — Ship `<Metadata>` helper component and `<Image>` component with lazy loading in `theokit/client`. React 19 already supports `<title>`/`<meta>` hoisting natively — we add ergonomic wrappers. Zero new dependencies.

## Goal

> Ship `<Metadata>` and `<Image>` components exported from `theokit/client` so that TheoKit apps have SEO-ready pages and optimized image loading, measured by `<Metadata title="..." description="..." />` rendering correct `<head>` tags in SSR AND `<Image>` rendering a lazy-loaded `<img>` with responsive `srcSet` in a test.

## Context

React 19 natively supports `<title>`, `<meta>`, `<link>` in the component tree — they're hoisted to `<head>` during `renderToPipeableStream`. TheoKit's layout already uses this (`app/layout.tsx` has `<title>` in JSX).

**What's missing:** a `<Metadata>` component for convenience (1 component instead of 5 tags) and an `<Image>` component with lazy loading + responsive sizes.

**What we're NOT building:** Next.js's `generateMetadata()` (requires RSC), image optimization CDN (requires runtime server), `next/image` loader architecture. KISS — pure React components.

## Baseline Context

### Files that will be touched

| File | LoC | Last commit | Why it exists | Invariants |
|---|---|---|---|---|
| `packages/theo/src/client/metadata.tsx` (NEW) | 0 | — | `<Metadata>` component | — |
| `packages/theo/src/client/image.tsx` (NEW) | 0 | — | `<Image>` component | — |
| `packages/theo/src/client/index.ts` | 48 | `f3c20f9` (2026-06-11) | Client barrel | Must re-export Metadata + Image |
| `tests/unit/metadata.test.ts` (NEW) | 0 | — | Metadata tests | — |
| `tests/unit/image.test.ts` (NEW) | 0 | — | Image tests | — |

### Architecture boundaries

- `client/` module (leaf). Only peer deps (react). No intra-monorepo imports.

## Prior Art & Related Work

- **React 19** — native `<title>`, `<meta>`, `<link>` hoisting (our foundation)
- **Next.js `<Image>`** — loader + CDN + blur placeholder (~800 LoC). We do ~60 LoC (lazy load + responsive).
- **Remix** — no metadata component (uses `export const meta = [...]` convention). Different paradigm.

## Objective

- [ ] `<Metadata>` renders title + description + og:title + og:description + og:image
- [ ] `<Metadata>` supports canonical URL and custom meta tags
- [ ] `<Image>` renders `<img>` with `loading="lazy"` by default
- [ ] `<Image>` generates `srcSet` from `sizes` prop
- [ ] `<Image>` supports `width`/`height` for CLS prevention
- [ ] Both exported from `theokit/client`
- [ ] 15+ tests GREEN

## ADRs

### D1 — Metadata as React component (not export convention)

**Decision:** `<Metadata title="..." />` component, not `export const metadata = {...}` (Next.js) or `export const meta = [...]` (Remix).

**Rationale:** Component approach works with React 19's native hoisting. No build-time extraction needed. Can be used inside any component (not just page-level). Per KISS — a component is simpler than a convention that requires framework-level extraction.

**Alternatives:** `export const metadata` convention — rejected: requires build-time extraction + RSC; TheoKit is client-by-default.

### D2 — Image without CDN/optimization (pure HTML attributes)

**Decision:** `<Image>` renders `<img>` with `loading="lazy"`, `decoding="async"`, `srcSet`, `sizes`. No image optimization CDN, no blur placeholder, no WebP conversion.

**Rationale:** Image optimization requires a server-side image pipeline (Sharp, Cloudinary, etc.). That's infra, not framework. TheoKit ships the HTML-level optimization (lazy load + responsive) which is the 80% value. Per YAGNI — CDN optimization is a v2 feature.

**Alternatives:** Full `next/image` clone with loader — rejected: 800 LoC + server-side deps for a feature most users solve with Cloudinary/imgix.

## Drawbacks & Risks

| Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| `<Metadata>` duplicate tags if layout + page both set `<title>` | Low | React 19 deduplicates — last rendered `<title>` wins | Built-in |
| `<Image>` without optimization still loads full-size images | Medium | Document: "use a CDN for production images". srcSet helps browsers pick right size. | Dev |

## Unresolved Questions

(none — React 19 metadata hoisting is well-documented. HTML img attributes are standard.)

## Dependency Graph

```
Phase 1 (Metadata + Image) ──▶ Phase 2 (Integration)
```

---

## Phase 1: Metadata + Image Components

### T1.1 — `<Metadata>` component

#### Objective
Create a convenience component that renders multiple `<head>` tags from a single props object.

#### Files to edit
```
packages/theo/src/client/metadata.tsx (NEW)
packages/theo/src/client/index.ts — export
tests/unit/metadata.test.ts (NEW)
```

#### Pseudo-code

```tsx
export interface MetadataProps {
  title?: string
  description?: string
  canonical?: string
  ogTitle?: string
  ogDescription?: string
  ogImage?: string
  ogType?: string
  twitterCard?: 'summary' | 'summary_large_image'
  children?: React.ReactNode  // custom <meta> tags
}

export function Metadata(props: MetadataProps) {
  return (
    <>
      {props.title && <title>{props.title}</title>}
      {props.description && <meta name="description" content={props.description} />}
      {props.canonical && <link rel="canonical" href={props.canonical} />}
      {props.ogTitle && <meta property="og:title" content={props.ogTitle ?? props.title} />}
      {/* ... */}
      {props.children}
    </>
  )
}
```

#### TDD
```
RED:   test_metadata_renders_title() — <Metadata title="Test"> renders <title>Test</title>
RED:   test_metadata_renders_description() — renders <meta name="description">
RED:   test_metadata_renders_og_tags() — renders og:title, og:description, og:image
RED:   test_metadata_renders_canonical() — renders <link rel="canonical">
RED:   test_metadata_title_fallback_to_og() — ogTitle defaults to title if not set
RED:   test_metadata_custom_children() — custom <meta> passed as children
RED:   test_metadata_no_props_no_crash() — empty <Metadata /> renders nothing
GREEN: Implement Metadata component
```

### T1.2 — `<Image>` component

#### Objective
Create an image component with lazy loading, responsive srcSet, and CLS prevention.

#### Files to edit
```
packages/theo/src/client/image.tsx (NEW)
packages/theo/src/client/index.ts — export
tests/unit/image.test.ts (NEW)
```

#### Pseudo-code

```tsx
export interface ImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  src: string
  alt: string
  width?: number
  height?: number
  sizes?: string
  srcSet?: string
  priority?: boolean  // if true: loading="eager" (above the fold)
}

export function Image({ priority, ...props }: ImageProps) {
  return (
    <img
      loading={priority ? 'eager' : 'lazy'}
      decoding="async"
      {...props}
    />
  )
}
```

#### TDD
```
RED:   test_image_renders_img() — <Image src="/photo.jpg" alt="test"> renders <img>
RED:   test_image_lazy_by_default() — loading="lazy" by default
RED:   test_image_priority_eager() — priority={true} → loading="eager"
RED:   test_image_decoding_async() — decoding="async" always
RED:   test_image_width_height() — width + height attributes set for CLS
RED:   test_image_srcset() — srcSet prop forwarded
RED:   test_image_sizes() — sizes prop forwarded
RED:   test_image_alt_required() — TypeScript enforces alt as required prop
GREEN: Implement Image component
```

---

## Phase 2: Integration Validation

```bash
turbo run build --filter=theokit --force
```

## Coverage Matrix

| # | Gap | Task | Resolution |
|---|---|---|---|
| 1 | No Metadata helper | T1.1 | `<Metadata title="..." />` |
| 2 | No OG tags convenience | T1.1 | og:title, og:description, og:image from props |
| 3 | No canonical link | T1.1 | `<link rel="canonical">` from prop |
| 4 | No `<Image>` component | T1.2 | `<Image>` with lazy + responsive |
| 5 | No CLS prevention | T1.2 | width/height attributes |
| 6 | No priority loading | T1.2 | `priority` prop → loading="eager" |

**Coverage: 6/6 gaps covered (100%)**

## Global Definition of Done

- [ ] `<Metadata>` and `<Image>` exported from `theokit/client`
- [ ] 15+ tests GREEN
- [ ] Build succeeds
- [ ] CHANGELOG updated

## Failure scenarios

(none — pure React components, no I/O)
