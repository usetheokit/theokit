/**
 * <Image> — optimized image component with lazy loading.
 *
 * Renders a standard <img> with:
 *   - loading="lazy" by default (eager with priority={true})
 *   - decoding="async" for non-blocking decode
 *   - width/height for CLS prevention
 *   - srcSet/sizes forwarded for responsive images
 *
 * No CDN, no Sharp, no build-time optimization — pure HTML attributes
 * that deliver 80% of the performance value at zero complexity.
 *
 * @example
 * ```tsx
 * import { Image } from 'theokit/client'
 *
 * <Image src="/team.jpg" alt="Team photo" width={800} height={600} />
 * <Image src="/hero.jpg" alt="Hero" priority />
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

export interface ImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  /** Image source URL (required). */
  src: string
  /** Alt text for accessibility (required). */
  alt: string
  /** If true, loading="eager" — use for above-the-fold images. */
  priority?: boolean
}

export function Image({ priority, loading, decoding, ...props }: ImageProps) {
  return (
    <img
      loading={loading ?? (priority ? 'eager' : 'lazy')}
      decoding={decoding ?? 'async'}
      {...props}
    />
  )
}
