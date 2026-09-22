import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { resolveUserModule } from '../../packages/theo/src/server/http/middleware-runner.js'

/**
 * B-250. `server/scan/agent-scan.ts:14` accepts `.ts`, `.tsx`, `.js` and `.jsx` for an agent, and
 * `middleware-runner.ts` resolved `context` and `middleware` as `.ts` ONLY.
 *
 * A JavaScript project therefore got agents that were found and an identity that silently was not:
 * `createServerContext` returned `{}`, every policy saw `subject: null`, and that is
 * indistinguishable from a caller who sent no credential. Measured 2026-09-22 by writing
 * `server/context.js` into a fixture and watching `createContext` never be invoked at all.
 */
describe('a user module may be JavaScript (B-250)', () => {
  const project = (files: Record<string, string>): string => {
    const root = mkdtempSync(join(tmpdir(), 'theo-user-module-'))
    mkdirSync(join(root, 'server'), { recursive: true })
    for (const [name, body] of Object.entries(files)) {
      writeFileSync(join(root, 'server', name), body)
    }
    return join(root, 'server')
  }

  it('test_a_javascript_context_is_found', () => {
    const dir = project({ 'context.js': 'export function createContext() { return {} }\n' })

    expect(
      resolveUserModule(dir, 'context'),
      'a `.js` context is invisible, so every policy in a JavaScript project sees `subject: null`',
    ).toBe(join(dir, 'context.js'))
  })

  it('test_a_typescript_context_still_wins_when_both_exist', () => {
    // The ordering is behaviour-preserving, not cosmetic: a project holding both must keep
    // resolving what it resolved before this change.
    const dir = project({
      'context.ts': 'export function createContext() { return {} }\n',
      'context.js': 'export function createContext() { return {} }\n',
    })

    expect(resolveUserModule(dir, 'context')).toBe(join(dir, 'context.ts'))
  })

  it('test_the_same_holds_for_middleware', () => {
    const dir = project({ 'middleware.jsx': 'export default []\n' })

    expect(
      resolveUserModule(dir, 'middleware'),
      'the two lookups in this file were hardcoded the same way and are fixed the same way',
    ).toBe(join(dir, 'middleware.jsx'))
  })

  it('test_an_absent_module_is_undefined_rather_than_a_guessed_path', () => {
    // A project with no context is the ORDINARY case. Returning a path that is not there would
    // turn it into a load error at request time.
    const dir = project({})

    expect(resolveUserModule(dir, 'context')).toBeUndefined()
  })
})
