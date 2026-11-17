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
  it('types keys', () => {
    const i = defineI18n({ defaultLocale: 'en', dictionaries: { en: { a: { b: 'x' } } } })
    expectTypeOf(i.translate).parameter(1).toEqualTypeOf<'a.b'>()
  })
})
