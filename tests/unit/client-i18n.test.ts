import { createElement } from 'react'
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
      dictionaries: { en: { a: 'A' }, pt: { a: 'A' } },
    })
    expect(partial.translate('pt', 'a')).toBe('A')
    expect(i18n.translate('en', 'missing' as never)).toBe('missing')
  })
  it('negotiates stored, then browser, then default', () => {
    expect(negotiateLocale('pt', ['en'], ['en', 'pt'], 'en')).toBe('pt')
    expect(negotiateLocale(null, ['pt-BR', 'en'], ['en', 'pt'], 'en')).toBe('pt')
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
})
