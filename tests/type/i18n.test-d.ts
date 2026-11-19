import { describe, it, expectTypeOf } from 'vitest'

import { defineI18n } from '../../packages/theo/src/client/i18n.js'

describe('defineI18n', () => {
  it('requires every locale to have every key', () => {
    defineI18n({
      defaultLocale: 'en',
      dictionaries: { en: { a: 'A', b: 'B' }, pt: { a: 'A', b: 'B' } },
    })
    defineI18n({
      defaultLocale: 'en',
      // @ts-expect-error pt lacks `b`
      dictionaries: { en: { a: 'A', b: 'B' }, pt: { a: 'A' } },
    })
  })
  it('rejects a key only present in a non-default locale', () => {
    defineI18n({
      defaultLocale: 'en',
      // @ts-expect-error pt has `c`, en does not
      dictionaries: { en: { a: 'A' }, pt: { a: 'A', c: 'C' } },
    })
  })
  it('types the bound client hook', () => {
    const i = defineI18n({ defaultLocale: 'en', dictionaries: { en: { a: 'A' }, pt: { a: 'A' } } })
    // Never invoked: hooks cannot run outside a component, this only type-checks.
    const component = (): void => {
      const { t } = i.useI18n()
      t('a')
      expectTypeOf(t).parameter(0).toEqualTypeOf<'a'>()
    }
    expectTypeOf(component).toEqualTypeOf<() => void>()
  })
  it('types keys', () => {
    const i = defineI18n({ defaultLocale: 'en', dictionaries: { en: { a: { b: 'x' } } } })
    expectTypeOf(i.translate).parameter(1).toEqualTypeOf<'a.b'>()
  })
})
