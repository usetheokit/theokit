import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { aliasPaths } from '../../src/alias-paths.js'

/**
 * A custom `--import-alias` must resolve to directories the template actually ships.
 *
 * This is the check that was missing when the layout moved: the mapping was written for a root-level
 * `app/` and `server/`, nothing tested it, and a generated project would have carried aliases
 * pointing at two directories that do not exist — a tsconfig error at the user's first import, in a
 * file they did not write.
 */
const TEMPLATE = join(import.meta.dirname, '../../templates/default')

describe('a custom import alias (--import-alias)', () => {
  it('points every alias at a directory the template ships', () => {
    for (const targets of Object.values(aliasPaths('~/*'))) {
      for (const target of targets) {
        const dir = target.replace('./', '').replace('/*', '')
        expect(existsSync(join(TEMPLATE, dir)), `${target} must exist in the template`).toBe(true)
      }
    }
  })

  it('maps the two domains and the root', () => {
    expect(aliasPaths('~/*')).toEqual({
      '~/*': ['./src/*'],
      '~/server/*': ['./src/server/*'],
      '~/app/*': ['./src/app/*'],
    })
  })

  it('accepts an alias written without the glob', () => {
    // `--import-alias '~'` is the same intent typed shorter; dropping the suffix must not produce
    // `~//*`.
    expect(Object.keys(aliasPaths('~'))).toEqual(['~/*', '~/server/*', '~/app/*'])
  })
})
