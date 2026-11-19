// @vitest-environment happy-dom
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect } from 'vitest'

import {
  defineI18n,
  I18nProvider,
  useI18n,
  negotiateLocale,
  formatNumber,
  formatRelativeTime,
} from '../../packages/theo/src/client/i18n.js'

const i18n = defineI18n({
  defaultLocale: 'en',
  dictionaries: {
    en: { greet: 'Hello, {name}', nav: { home: 'Home' } },
    xx: { greet: 'Hi, {name}', nav: { home: 'Home-xx' } },
  },
})

function Page(): ReturnType<typeof createElement> {
  const { t } = useI18n()
  return createElement('p', null, `${t('greet', { name: 'Ana' })} / ${t('nav.home')}`)
}
const render = (locale: 'en' | 'xx'): string =>
  renderToStaticMarkup(createElement(I18nProvider, { i18n, locale }, createElement(Page)))

describe('client i18n', () => {
  it('renders the same page in each language', () => {
    expect(render('en')).toBe('<p>Hello, Ana / Home</p>')
    expect(render('xx')).toBe('<p>Hi, Ana / Home-xx</p>')
  })
  it('falls back to the default locale, then the key', () => {
    const partial = defineI18n({
      defaultLocale: 'en',
      dictionaries: { en: { a: 'A', b: 'B' }, xx: { a: 'A', b: 'B' } },
    })
    // Runtime-only partial dictionary (the types forbid this; JSON loaded at runtime may not).
    const loose = defineI18n({
      defaultLocale: 'en',
      dictionaries: { en: { a: 'A', b: 'B' }, xx: { a: 'A-xx' } } as never,
    })
    expect(partial.translate('xx', 'b')).toBe('B')
    expect(loose.translate('xx', 'a' as never)).toBe('A-xx')
    expect(loose.translate('xx', 'b' as never)).toBe('B')
    expect(i18n.translate('en', 'missing' as never)).toBe('missing')
  })
  it('negotiates stored, then browser, then default', () => {
    expect(negotiateLocale('xx', ['en'], ['en', 'xx'], 'en')).toBe('xx')
    expect(negotiateLocale(null, ['xx-YY', 'en'], ['en', 'xx'], 'en')).toBe('xx')
    expect(negotiateLocale(null, ['xx'], ['en', 'xx-YY'], 'en')).toBe('xx-YY')
    expect(negotiateLocale('xx-ZZ', [], ['en', 'xx-YY'], 'en')).toBe('xx-YY')
    expect(negotiateLocale('xx', ['fr'], ['en', 'xx'], 'en')).toBe('en')
  })
  it('formats by locale', () => {
    expect(formatNumber('en', 1234.5)).toBe('1,234.5')
    expect(formatNumber('pt-BR', 1234.5)).toBe('1.234,5')
    expect(formatRelativeTime('en', 0, 3 * 86400 * 1000)).toBe('3 days ago')
  })
  it('throws outside a provider', () => {
    expect(() => renderToStaticMarkup(createElement(Page))).toThrow(/I18nProvider/)
  })
  it('follows a locale prop that changes after mount; setLocale cannot override it', async () => {
    let set: ((l: 'en' | 'xx') => void) | undefined
    function Probe(): ReturnType<typeof createElement> {
      const c = useI18n<'en' | 'xx'>()
      set = c.setLocale
      return createElement('p', null, c.t('nav.home'))
    }
    const el = document.createElement('div')
    const root = createRoot(el)
    const mount = (locale: 'en' | 'xx'): ReturnType<typeof createElement> =>
      createElement(I18nProvider, { i18n, locale }, createElement(Probe))
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    await act(async () => root.render(mount('en')))
    expect(el.textContent).toBe('Home')
    await act(async () => root.render(mount('xx')))
    expect(el.textContent).toBe('Home-xx')
    await act(async () => set?.('en'))
    expect(el.textContent).toBe('Home-xx')
    await act(async () => root.unmount())
  })
})
