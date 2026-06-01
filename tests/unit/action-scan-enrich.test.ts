/**
 * RED tests for T1.4 — enriched action-scan with collision detection
 * (EC-2), comment stripping (EC-9), and reserved-name rejection.
 *
 * Per plan g3-server-actions-and-useaction v1.2 § Phase 1 / T1.4.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  ActionScanError,
  scanServerActionsEnriched,
} from '../../packages/theo/src/server/scan/action-scan.js'

let serverDir: string

beforeEach(() => {
  const root = mkdtempSync(join(tmpdir(), 'theokit-action-scan-'))
  serverDir = join(root, 'server')
  mkdirSync(join(serverDir, 'actions'), { recursive: true })
})

afterEach(() => {
  // best-effort cleanup
  try {
    rmSync(serverDir, { recursive: true, force: true })
  } catch {
    // ignore — temp dir may already be cleaned by test isolation
  }
})

function write(file: string, contents: string): void {
  const full = join(serverDir, 'actions', file)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, contents)
}

describe('scanServerActionsEnriched — basic discovery', () => {
  it('should detect a simple action file and default accept to json', () => {
    write(
      'hello.ts',
      `
      import { z } from 'zod'
      import { defineAction } from 'theokit/server'
      export default defineAction({
        input: z.object({ name: z.string() }),
        handler: ({ input }) => ({ greeting: 'Hi ' + input.name }),
      })
    `,
    )
    const entries = scanServerActionsEnriched(serverDir)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      name: 'hello',
      accept: 'json',
      hasInput: true,
    })
  })

  it('should detect accept:"form" marker', () => {
    write(
      'upload.ts',
      `
      import { defineAction } from 'theokit/server'
      export default defineAction({
        accept: 'form',
        input: z.object({ file: z.string() }),
        handler: () => ({ ok: true }),
      })
    `,
    )
    const entries = scanServerActionsEnriched(serverDir)
    expect(entries[0].accept).toBe('form')
  })

  it('should skip co-located test files', () => {
    write('hello.ts', `export default defineAction({input:z.object({}),handler:()=>null})`)
    write('hello.test.ts', `import {describe} from 'vitest'; describe('hello',()=>{})`)
    const entries = scanServerActionsEnriched(serverDir)
    expect(entries).toHaveLength(1)
    expect(entries[0].name).toBe('hello')
  })

  it('should handle nested action dirs with slash-separated names', () => {
    write('admin/users.ts', `export default defineAction({input:z.object({}),handler:()=>null})`)
    const entries = scanServerActionsEnriched(serverDir)
    expect(entries[0].name).toBe('admin/users')
  })

  it('should return empty array for missing actions dir', () => {
    rmSync(join(serverDir, 'actions'), { recursive: true, force: true })
    expect(scanServerActionsEnriched(serverDir)).toEqual([])
  })

  it('should emit urlPath as /api/__actions/<file>/<exportName> (T7.1 wire fix)', () => {
    write('foo.ts', `export default defineAction({input:z.object({}),handler:()=>null})`)
    const entries = scanServerActionsEnriched(serverDir)
    expect(entries[0].urlPath).toBe('/api/__actions/foo/default')
  })
})

describe('scanServerActionsEnriched — EC-2 collision detection', () => {
  it('should throw ActionScanError on file vs dir name collision', () => {
    write('foo.ts', `export default defineAction({input:z.object({}),handler:()=>null})`)
    write('foo/bar.ts', `export default defineAction({input:z.object({}),handler:()=>null})`)
    let caught: unknown
    try {
      scanServerActionsEnriched(serverDir)
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(ActionScanError)
    expect((caught as ActionScanError).code).toBe('NAME_COLLISION')
    expect((caught as ActionScanError).conflictingPaths.length).toBeGreaterThanOrEqual(2)
  })

  it('should throw ActionScanError on reserved JS names (index, constructor, __proto__)', () => {
    write('index.ts', `export default defineAction({input:z.object({}),handler:()=>null})`)
    let caught: unknown
    try {
      scanServerActionsEnriched(serverDir)
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(ActionScanError)
    expect((caught as ActionScanError).code).toBe('RESERVED_NAME')
  })
})

describe('scanServerActionsEnriched — EC-9 comment stripping', () => {
  it("should ignore accept:'form' inside line comment", () => {
    write(
      'jcomment.ts',
      `
      import { defineAction } from 'theokit/server'
      // accept: 'form' — this is just documentation
      export default defineAction({
        accept: 'json',
        input: z.object({ name: z.string() }),
        handler: () => null,
      })
    `,
    )
    const entries = scanServerActionsEnriched(serverDir)
    expect(entries[0].accept).toBe('json')
  })

  it("should ignore accept:'form' inside block comment", () => {
    write(
      'bcomment.ts',
      `
      import { defineAction } from 'theokit/server'
      /* example: accept: 'form' below */
      export default defineAction({
        accept: 'json',
        input: z.object({ name: z.string() }),
        handler: () => null,
      })
    `,
    )
    const entries = scanServerActionsEnriched(serverDir)
    expect(entries[0].accept).toBe('json')
  })
})
