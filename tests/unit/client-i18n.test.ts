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
    pt: { greet: 'Olá, {name}', nav: { home: 'Início' } },
  },
})

function Page(): ReturnType<typeof createElement> {
  const { t } = useI18n()
  return createElement('p', null, `${t('greet', { name: 'Ana' })} / ${t('nav.home')}`)
}
const render = (locale: 'en' | 'pt'): string =>
  renderToStaticMarkup(createElement(I18nProvider, { i18n, locale }, createElement(Page)))

describe('client i18n', () => {
  it('renders the same page in each language', () => {
    expect(render('en')).toBe('<p>Hello, Ana / Home</p>')
    expect(render('pt')).toBe('<p>Olá, Ana / Início</p>')
  })
  it('falls back to the default locale, then the key', () => {
    const partial = defineI18n({
      defaultLocale: 'en',
      dictionaries: { en: { a: 'A', b: 'B' }, pt: { a: 'A', b: 'B' } },
    })
    // Runtime-only partial dictionary (the types forbid this; JSON loaded at runtime may not).
    const loose = defineI18n({
      defaultLocale: 'en',
      dictionaries: { en: { a: 'A', b: 'B' }, pt: { a: 'Á' } } as never,
    })
    expect(partial.translate('pt', 'b')).toBe('B')
    expect(loose.translate('pt', 'a' as never)).toBe('Á')
    expect(loose.translate('pt', 'b' as never)).toBe('B')
    expect(i18n.translate('en', 'missing' as never)).toBe('missing')
  })
  it('negotiates stored, then browser, then default', () => {
    expect(negotiateLocale('pt', ['en'], ['en', 'pt'], 'en')).toBe('pt')
    expect(negotiateLocale(null, ['pt-BR', 'en'], ['en', 'pt'], 'en')).toBe('pt')
    expect(negotiateLocale(null, ['pt'], ['en', 'pt-BR'], 'en')).toBe('pt-BR')
    expect(negotiateLocale('pt-PT', [], ['en', 'pt-BR'], 'en')).toBe('pt-BR')
    expect(negotiateLocale('xx', ['fr'], ['en', 'pt'], 'en')).toBe('en')
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
    let set: ((l: 'en' | 'pt') => void) | undefined
    function Probe(): ReturnType<typeof createElement> {
      const c = useI18n<'en' | 'pt'>()
      set = c.setLocale
      return createElement('p', null, c.t('nav.home'))
    }
    const el = document.createElement('div')
    const root = createRoot(el)
    const mount = (locale: 'en' | 'pt'): ReturnType<typeof createElement> =>
      createElement(I18nProvider, { i18n, locale }, createElement(Probe))
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    await act(async () => root.render(mount('en')))
    expect(el.textContent).toBe('Home')
    await act(async () => root.render(mount('pt')))
    expect(el.textContent).toBe('Início')
    await act(async () => set?.('en'))
    expect(el.textContent).toBe('Início')
    await act(async () => root.unmount())
  })
})
