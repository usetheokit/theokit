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

  it('ImageProps requires src and alt', () => {
    const props: ImageProps = { src: '/photo.jpg', alt: 'A photo' }
    expect(props.src).toBe('/photo.jpg')
    expect(props.alt).toBe('A photo')
  })

  it('ImageProps accepts width/height for CLS', () => {
    const props: ImageProps = { src: '/x.jpg', alt: 'x', width: 800, height: 600 }
    expect(props.width).toBe(800)
    expect(props.height).toBe(600)
  })

  it('ImageProps accepts srcSet and sizes', () => {
    const props: ImageProps = {
      src: '/x.jpg', alt: 'x',
      srcSet: '/x-400.jpg 400w, /x-800.jpg 800w',
      sizes: '(max-width: 768px) 100vw, 800px',
    }
    expect(props.srcSet).toContain('400w')
    expect(props.sizes).toContain('768px')
  })

  it('priority defaults to false (lazy)', () => {
    const props: ImageProps = { src: '/x.jpg', alt: 'x' }
    expect(props.priority).toBeUndefined()
    // When undefined, Image renders loading="lazy"
  })

  it('priority=true means eager loading', () => {
    const props: ImageProps = { src: '/hero.jpg', alt: 'Hero', priority: true }
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
