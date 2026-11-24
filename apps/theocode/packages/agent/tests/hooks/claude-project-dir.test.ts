/**
 * `CLAUDE_PROJECT_DIR` reaches a hook through `projectDirEnv`, and never the process environment.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { buildHookHandlers } from '../../src/hooks/build-handlers.js'
import { hookFingerprint } from '../../src/hooks/hook-trust.js'
import type { HookSpec } from '../../src/hooks/hooks-spec.js'
import { ctxTurn } from './hooks-test-helpers.js'

let dir: string
let saved: string | undefined

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'projdir-'))
  saved = process.env.CLAUDE_PROJECT_DIR
  delete process.env.CLAUDE_PROJECT_DIR
})
afterEach(() => {
  if (saved !== undefined) process.env.CLAUDE_PROJECT_DIR = saved
  rmSync(dir, { recursive: true, force: true })
})

describe('CLAUDE_PROJECT_DIR for hooks', () => {
  it('test_a_hook_sees_the_cwd_and_process_env_stays_clean', async () => {
    const out = join(dir, 'printed.txt')
    const spec: HookSpec = {
      event: 'PostToolUse',
      command: `printf "%s" "$CLAUDE_PROJECT_DIR" > ${out}`,
      timeout_ms: 5_000,
    }
    const handlers = buildHookHandlers([spec], {
      trusted: true,
      approved: new Set([hookFingerprint(spec)]),
      cwd: dir,
    })
    await handlers.transform_tool_result?.('a plain string result', ctxTurn())
    expect(readFileSync(out, 'utf8')).toBe(dir)
    expect(process.env.CLAUDE_PROJECT_DIR).toBeUndefined()
  })
})
