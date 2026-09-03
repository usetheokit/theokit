import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { TAILWIND_CSS_IMPORT } from '../../src/tailwind-css-import.js'

/**
 * The `--tailwind` import must satisfy the formatter the generated project ships.
 *
 * It is written by `applyOptions`, which the scaffold-level format check cannot reach: that test
 * runs `scaffold()`, and this line is added afterwards by the CLI. So it is asked directly, by
 * piping it through Prettier with the template's own config — the same question the user's
 * `format:check` will ask on their first commit.
 */
const PRETTIER = resolve(import.meta.dirname, '../../../../node_modules/.bin/prettier')
const TEMPLATE_CONFIG = resolve(import.meta.dirname, '../../templates/default/.prettierrc')

describe('the Tailwind stylesheet import', () => {
  it('is already formatted to the config the template carries', () => {
    const formatted = execFileSync(PRETTIER, ['--parser', 'css', '--config', TEMPLATE_CONFIG], {
      input: TAILWIND_CSS_IMPORT,
      encoding: 'utf8',
    })

    // Equality, not a `--check` pass: this is the exact text written to the user's `globals.css`,
    // so anything Prettier would rewrite is a diff the user inherits.
    expect(formatted).toBe(TAILWIND_CSS_IMPORT)
  })
})
