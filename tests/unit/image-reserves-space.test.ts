import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { Image, type ImageProps } from '../../packages/theo/src/client/image.js'

/**
 * B-032 — `<Image>`'s own docstring claimed "width/height for CLS prevention"
 * and the component enforced neither. Dimensions were forwarded when present and
 * absent when not, so the page shifted while the image loaded — the defect the
 * comment said the component existed to prevent.
 *
 * `srcSet` without `sizes` was accepted the same way. The browser then resolves
 * the candidate against a default of `100vw`, so it downloads an image chosen
 * for the wrong width — quietly, and usually the largest one.
 *
 * Both are refused by the type signature, which is the build-time failure the
 * item asks for. These tests cover the other half: a JavaScript caller, where
 * types are advisory, must be told rather than served a broken page.
 *
 * Written with `createElement` rather than JSX because the root vitest project
 * includes `tests/**\/*.test.ts` only — a `.tsx` file here would never run, and
 * a test that never runs is worse than none.
 */

/** Cast at the boundary: these cases are what an untyped caller does. */
function render(props: Record<string, unknown>): string {
  return renderToStaticMarkup(createElement(Image, props as unknown as ImageProps))
}

describe('Image reserves its space (B-032)', () => {
  it('test_dimensions_reach_the_element', () => {
    const html = render({ src: '/a.jpg', alt: 'a', width: 800, height: 600 })

    expect(html).toContain('width="800"')
    expect(html).toContain('height="600"')
  })

  it('test_a_missing_dimension_is_refused_by_name', () => {
    // The message names the props and the consequence, not "invalid props".
    expect(() => render({ src: '/a.jpg', alt: 'a' })).toThrow(/width.*height|height.*width/i)
  })

  it('test_a_half_declared_dimension_is_refused_too', () => {
    // Width alone reserves nothing: the aspect ratio needs both.
    expect(() => render({ src: '/a.jpg', alt: 'a', width: 800 })).toThrow(/height/i)
  })

  it('test_srcset_without_sizes_is_refused_by_name', () => {
    expect(() =>
      render({ src: '/a.jpg', alt: 'a', width: 400, height: 300, srcSet: '/a-400.jpg 400w' }),
    ).toThrow(/sizes/i)
  })

  it('test_srcset_with_sizes_is_served', () => {
    const html = render({
      src: '/a.jpg',
      alt: 'a',
      width: 400,
      height: 300,
      srcSet: '/a-400.jpg 400w, /a-800.jpg 800w',
      sizes: '(max-width: 768px) 100vw, 400px',
    })

    expect(html).toContain('/a-800.jpg 800w')
    expect(html).toContain('(max-width: 768px) 100vw, 400px')
  })

  it('test_lazy_by_default_and_eager_with_priority', () => {
    // Unchanged behaviour, asserted because the refusals rewrite the parameter
    // list and could have dropped it.
    expect(render({ src: '/a.jpg', alt: 'a', width: 1, height: 1 })).toContain('loading="lazy"')
    expect(render({ src: '/a.jpg', alt: 'a', width: 1, height: 1, priority: true })).toContain(
      'loading="eager"',
    )
  })
})
