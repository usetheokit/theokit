import { describe, expect, it } from 'vitest'

import { renderCloudflareWorkerEntry } from '../../packages/theo/src/adapters/cloudflare.js'

/**
 * B-257 — `IDENTIFIER` answers "could this be a name?", and the emitter needs "can this be THIS
 * name?". They differ on exactly the reserved words.
 *
 * `factory` lands as a bare binding in `import { <factory> } from '<module>'`. `/^[A-Za-z_$][\w$]*$/`
 * accepts `default`, `class`, `import` and `await` — all of them well-formed identifiers and none
 * of them bindable there. `import { default } from 'x'` is a SyntaxError, so the generated entry
 * does not parse and the deploy fails at load with a message about the emitted file rather than
 * about the config line that caused it.
 *
 * The guard exists because this field cannot be escaped: `module` and `options` go through
 * `JSON.stringify`, and a quoted string does not parse where a binding belongs. So the only defence
 * is refusing the value, which makes the completeness of the refusal the whole of the protection.
 *
 * `default` is singled out in its own case because it is the one a real config reaches by accident:
 * `export default createStore` is the ordinary shape of the module being named.
 */
describe('a baked factory is a usable binding (B-257)', () => {
  const render = (factory: string): string =>
    renderCloudflareWorkerEntry({
      ssrStreaming: false,
      rateLimit: { windowMs: 1000, max: 1, store: { module: '@x/store', factory } },
    })

  it('test_default_is_refused_because_the_import_would_not_parse', () => {
    // The accidental one: `export default createStore` invites `factory: 'default'`.
    expect(() => render('default')).toThrow(/factory/i)
  })

  for (const word of ['class', 'import', 'function', 'await', 'const', 'new', 'return']) {
    it(`test_${word}_is_refused_as_a_factory_name`, () => {
      expect(() => render(word), `${word} reached the emitter as a bare binding`).toThrow(
        /factory/i,
      )
    })
  }

  it('test_an_ordinary_name_is_still_accepted', () => {
    // The refusal must be the reserved words and not the field. A guard that refused everything
    // would pass every case above and make the feature unreachable.
    const source = render('createStore')
    expect(source).toContain('createStore')
  })

  it('test_a_name_that_merely_contains_a_keyword_is_accepted', () => {
    // `defaultStore` is a legal binding. A substring match would refuse it, which is the
    // over-correction this case exists to catch.
    expect(() => render('defaultStore')).not.toThrow()
  })
})
