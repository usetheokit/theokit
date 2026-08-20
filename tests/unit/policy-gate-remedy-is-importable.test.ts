import { describe, it, expect } from 'vitest'

import * as serverDefine from '../../packages/theo/src/server/define/index.js'
import { MissingRoutePolicyError } from '../../packages/theo/src/server/scan/errors.js'

/**
 * The build gate refuses a route file that declares no policy, and its message
 * tells the author to call `requireOwner(...)`. That message shipped while
 * `requireOwner` was exported by no package entry point at all - a loud gate whose
 * named remedy could not be imported.
 *
 * The programme's fifth benchmark metric is that a failure names what to do. An
 * error naming an unreachable symbol fails it in the worst available way: it reads
 * as actionable and is not.
 *
 * The second test is the one that keeps this closed. Asserting the export exists
 * is not enough - the message could still name a different path tomorrow. It
 * asserts that the import path the ERROR names actually exports the symbol the
 * ERROR names.
 */

describe('the policy gate names a remedy that can be imported', () => {
  it('test_the_authorization_primitive_is_reachable_from_a_public_entry_point', () => {
    expect(typeof serverDefine.requireOwner).toBe('function')
  })

  it('test_the_error_message_names_an_import_that_actually_exports_what_it_names', () => {
    const message = new MissingRoutePolicyError({
      file: 'server/routes/orders.ts',
      routePath: '/api/orders',
      methods: ['GET'],
    }).message

    // The message must carry an import line, and every symbol it imports must be
    // reachable from the module it names.
    const importLine = /import \{([^}]+)\} from '([^']+)'/.exec(message)
    expect(importLine, 'the message carries no import line').not.toBeNull()

    const [, symbols, from] = importLine!
    expect(from).toBe('theokit/server/define')
    for (const symbol of symbols
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)) {
      expect(serverDefine, `${symbol} is named by the error and not exported`).toHaveProperty(
        symbol,
      )
    }
  })

  it('test_the_primitive_answers_the_question_the_message_says_it_answers', () => {
    const { requireOwner } = serverDefine

    expect(requireOwner({ id: 'u1' }, 'u1').allowed).toBe(true)
    expect(requireOwner({ id: 'u2' }, 'u1').allowed).toBe(false)
    expect(requireOwner(null, 'u1').allowed).toBe(false)
  })
})
