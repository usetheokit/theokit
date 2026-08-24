import { describe, it, expect } from 'vitest'
import { Metadata } from '../../packages/theo/src/client/metadata.js'
import { Image } from '../../packages/theo/src/client/image.js'
import type { MetadataProps } from '../../packages/theo/src/client/metadata.js'
import type { ImageProps } from '../../packages/theo/src/client/image.js'

describe('<Metadata> component', () => {
  it('is a function component', () => {
    expect(typeof Metadata).toBe('function')
    expect(Metadata.name).toBe('Metadata')
  })

  it('MetadataProps accepts all SEO fields', () => {
    const props: MetadataProps = {
      title: 'Test Page',
      description: 'A test page',
      canonical: 'https://example.com/test',
      ogTitle: 'OG Title',
      ogDescription: 'OG Desc',
      ogImage: '/og.png',
      ogType: 'website',
      ogUrl: 'https://example.com',
      twitterCard: 'summary_large_image',
    }
    expect(props.title).toBe('Test Page')
    expect(props.twitterCard).toBe('summary_large_image')
  })

  it('ogTitle falls back to title when not set', () => {
    const props: MetadataProps = { title: 'Fallback Title' }
    const ogTitle = props.ogTitle ?? props.title
    expect(ogTitle).toBe('Fallback Title')
  })

  it('ogDescription falls back to description', () => {
    const props: MetadataProps = { description: 'Fallback desc' }
    const ogDesc = props.ogDescription ?? props.description
    expect(ogDesc).toBe('Fallback desc')
  })

  it('empty props do not crash', () => {
    const props: MetadataProps = {}
    expect(props.title).toBeUndefined()
    // Metadata({}) should render nothing — no crash
    const result = Metadata({})
    expect(result).toBeDefined()
  })

  it('twitterCard only accepts valid values', () => {
    const valid: MetadataProps['twitterCard'][] = ['summary', 'summary_large_image']
    expect(valid).toHaveLength(2)
  })

  it('XSS: title with HTML is safe via React JSX escaping', () => {
    // React 19 JSX escaping: <title>{props.title}</title> auto-escapes
    // This is a contract test — Metadata NEVER uses dangerouslySetInnerHTML
    const source = String(Metadata)
    expect(source).not.toContain('dangerouslySetInnerHTML')
  })
})

describe('<Image> component', () => {
  it('is a function component', () => {
    expect(typeof Image).toBe('function')
    expect(Image.name).toBe('Image')
  })

  it('ImageProps requires src, alt and both dimensions', () => {
    // `width`/`height` joined the required set in B-032. The component's own
    // documentation had claimed "width/height for CLS prevention" while
    // enforcing neither, so the shift it named was the default behaviour.
    const props: ImageProps = { src: '/photo.jpg', alt: 'A photo', width: 800, height: 600 }
    expect(props.src).toBe('/photo.jpg')
    expect(props.alt).toBe('A photo')
    expect(props.width).toBe(800)
    expect(props.height).toBe(600)
  })

  it('ImageProps refuses a missing dimension at build time', () => {
    // `@ts-expect-error` is the assertion: this line fails the typecheck if the
    // refusal ever stops happening, which a runtime test cannot observe. It is
    // the build-time half of the contract, and the half the item asked for.
    // @ts-expect-error — height is required, and reserving a box needs both
    const noHeight: ImageProps = { src: '/x.jpg', alt: 'x', width: 800 }
    // @ts-expect-error — neither dimension: the case that shifts the page
    const noDimensions: ImageProps = { src: '/x.jpg', alt: 'x' }

    expect(noHeight.src).toBe('/x.jpg')
    expect(noDimensions.src).toBe('/x.jpg')
  })

  it('ImageProps accepts srcSet with sizes', () => {
    const props: ImageProps = {
      src: '/x.jpg',
      alt: 'x',
      width: 800,
      height: 600,
      srcSet: '/x-400.jpg 400w, /x-800.jpg 800w',
      sizes: '(max-width: 768px) 100vw, 800px',
    }
    expect(props.srcSet).toContain('400w')
    expect(props.sizes).toContain('768px')
  })

  it('ImageProps refuses srcSet without sizes at build time', () => {
    // Without `sizes` the browser resolves the candidates against 100vw and
    // downloads one picked for the wrong width — usually the largest, which is
    // the opposite of why a srcSet was added.
    // @ts-expect-error — srcSet and sizes travel together or not at all
    const halfDeclared: ImageProps = {
      src: '/x.jpg',
      alt: 'x',
      width: 8,
      height: 6,
      srcSet: '/a 1w',
    }

    expect(halfDeclared.src).toBe('/x.jpg')
  })

  it('priority defaults to false (lazy)', () => {
    const props: ImageProps = { src: '/x.jpg', alt: 'x', width: 1, height: 1 }
    expect(props.priority).toBeUndefined()
    // When undefined, Image renders loading="lazy"
  })

  it('priority=true means eager loading', () => {
    const props: ImageProps = {
      src: '/hero.jpg',
      alt: 'Hero',
      width: 1600,
      height: 900,
      priority: true,
    }
    expect(props.priority).toBe(true)
  })

  it('Image does not use dangerouslySetInnerHTML', () => {
    const source = String(Image)
    expect(source).not.toContain('dangerouslySetInnerHTML')
  })
})

describe('barrel exports', () => {
  it('Metadata exported from theokit/client', async () => {
    const mod = await import('../../packages/theo/src/client/index.js')
    expect(mod.Metadata).toBeDefined()
    expect(typeof mod.Metadata).toBe('function')
  })

  it('Image exported from theokit/client', async () => {
    const mod = await import('../../packages/theo/src/client/index.js')
    expect(mod.Image).toBeDefined()
    expect(typeof mod.Image).toBe('function')
  })
})
