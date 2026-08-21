/**
 * <Image> — an image that reserves its space before the pixels arrive.
 *
 * Renders a standard <img> with:
 *   - loading="lazy" by default (eager with priority={true})
 *   - decoding="async" for non-blocking decode
 *   - width/height REQUIRED, so the box is reserved and the page does not shift
 *   - srcSet only alongside sizes, so the browser picks against a real width
 *
 * No CDN, no Sharp, no build-time optimization — pure HTML attributes
 * that deliver 80% of the performance value at zero complexity. **Nothing here
 * resizes or re-encodes an image, and the framework ships no fonts module.**
 * That is a deliberate scope, stated so a reader learns it from the docs rather
 * than from a blurry logo (B-032).
 *
 * ## Why two props are required rather than encouraged
 *
 * The previous version documented "width/height for CLS prevention" and enforced
 * neither: both were forwarded when present and absent when not, so the very
 * shift the comment named was the default. `srcSet` was accepted without
 * `sizes` the same way, and a browser with no `sizes` resolves candidates
 * against `100vw` — it downloads an image chosen for the wrong width, usually
 * the largest, which is the opposite of what a `srcSet` was added to do.
 *
 * Both are refused by the type signature, so a TypeScript caller fails at build
 * time with the prop named. The runtime check below is for JavaScript callers,
 * where the types are advice: fail fast and by name, rather than serve a page
 * that shifts (`rules/error-handling.md`).
 *
 * @example
 * ```tsx
 * import { Image } from 'theokit/client'
 *
 * <Image src="/team.jpg" alt="Team photo" width={800} height={600} />
 * <Image src="/hero.jpg" alt="Hero" width={1600} height={900} priority />
 * <Image
 *   src="/product.jpg"
 *   alt="Product"
 *   width={400}
 *   height={300}
 *   srcSet="/product-400.jpg 400w, /product-800.jpg 800w"
 *   sizes="(max-width: 768px) 100vw, 400px"
 * />
 * ```
 */

/**
 * Raised when a caller asks for an image the component cannot render safely.
 *
 * Deliberately not exported from `theokit/client`: nothing catches an error thrown
 * during render, so a public symbol here would be one nobody imports — the orphan
 * export the code-quality gate exists to find. The message is the contract.
 */
class ImageContractError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImageContractError'
  }
}

type ImgAttributes = Omit<
  React.ImgHTMLAttributes<HTMLImageElement>,
  'src' | 'alt' | 'srcSet' | 'sizes' | 'width' | 'height'
>

/**
 * `srcSet` and `sizes` travel together or not at all. Expressed as a union so
 * the compiler refuses the half-declared case by name — the build-time failure,
 * with no runtime cost for the callers who get it right.
 */
type ResponsiveProps = { srcSet: string; sizes: string } | { srcSet?: never; sizes?: never }

export type ImageProps = ImgAttributes &
  ResponsiveProps & {
    /** Image source URL (required). */
    src: string
    /** Alt text for accessibility (required). */
    alt: string
    /** Intrinsic width. Required: without it the browser cannot reserve the box. */
    width: number | string
    /** Intrinsic height. Required: the aspect ratio needs both. */
    height: number | string
    /** If true, loading="eager" — use for above-the-fold images. */
    priority?: boolean
  }

// `Readonly<...>` on the parameter, not `readonly` field by field (agent-builder#319): React props
// must NOT be mutated, and `ImageProps` extends `React.ImgHTMLAttributes`, whose fields come from
// outside and cannot be annotated here. The wrapper covers the inherited ones alongside its own.
export function Image({ priority, loading, decoding, ...props }: Readonly<ImageProps>) {
  // Read through a widened view on purpose. TypeScript proves these are present, and the linter
  // says so; a JavaScript caller has had no such proof applied, and this whole block exists for
  // them. Narrowing the view to what the compiler already knows would delete the check and keep the
  // comment — the shape `B-022` describes.
  const given = props as Partial<Record<'width' | 'height' | 'srcSet' | 'sizes', unknown>>

  if (given.width === undefined || given.height === undefined) {
    throw new ImageContractError(
      `<Image src="${props.src}"> needs both width and height. They reserve the box before the ` +
        `image loads; without them the page shifts when it arrives. Pass the intrinsic pixel ` +
        `dimensions — CSS may still resize it.`,
    )
  }

  if (given.srcSet !== undefined && given.sizes === undefined) {
    throw new ImageContractError(
      `<Image src="${props.src}"> declares srcSet without sizes. The browser then resolves the ` +
        `candidates against 100vw and downloads one chosen for the wrong width — usually the ` +
        `largest. Pass sizes, e.g. sizes="(max-width: 768px) 100vw, 400px".`,
    )
  }

  return (
    <img
      loading={loading ?? (priority ? 'eager' : 'lazy')}
      decoding={decoding ?? 'async'}
      {...props}
    />
  )
}
