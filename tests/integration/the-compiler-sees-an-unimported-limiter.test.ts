import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * B-262 / T2.1 — the regression that keeps the compiler's sight.
 *
 * The whole claim of this item is that a defect class moved from invisible to refused. B-257 shipped
 * an entry using `createDurableRateLimiterWeb` at module scope without importing it; the entry threw
 * when it LOADED and `tsc` reported nothing, because the entry was a string returned by a function
 * and no string is type-checked.
 *
 * `adapters/entries/rate-limit-entry.ts` is a real file under the package-source include, so the
 * same deletion is now a compile error. **This test is what stops that from silently reverting** —
 * move the file out from under the include, or inline it back into an emitted fragment, and this
 * goes red.
 *
 * ## Why it runs tsc rather than asserting a path
 *
 * Asserting that the file sits under an include pattern proves the CONFIGURATION, and the sibling
 * unit test already does that. It does not prove the compiler acts on it. A claim about a gate is
 * worth what its demonstration is worth, so this one runs the gate.
 *
 * The run is scoped to one file with a minimal tsconfig, which is why it costs seconds rather than
 * the eight minutes a full project typecheck takes here.
 */

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..', '..')
// The compiler by absolute path, never through PATH: `sonarjs/no-os-command-from-path` is right
// that a writable PATH entry decides which binary runs, and this test's whole value is that the
// binary it runs is the project's own.
const TSC = join(repoRoot, 'node_modules', '.bin', 'tsc')
const ENTRY = join(
  repoRoot,
  'packages',
  'theo',
  'src',
  'server',
  'rate-limit',
  'build-rate-limiter.ts',
)

let workspace: string

/** The entry, with its imports rewritten to a stub so the probe needs no workspace resolution. */
function entryWithStubbedImports(): string {
  const src = readFileSync(ENTRY, 'utf8')
  return src.replace(/from '\.\/[^']+'/g, "from './stubs.js'")
}

describe('the compiler sees an unimported limiter (B-262, T2.1)', () => {
  beforeAll(() => {
    workspace = mkdtempSync(join(tmpdir(), 'theo-tsc-'))
  })

  afterAll(() => {
    if (workspace !== undefined) rmSync(workspace, { recursive: true, force: true })
  })

  it('test_the_intact_entry_typechecks', () => {
    // The control. Without it, the mutation below proves only that a broken fixture is broken.
    const stubs = `
export interface RateLimitConfig { windowMs: number; max: number }
export interface RateLimitResult { limited: boolean; headers: Record<string, string> }
export interface RateLimitStore { incr(k: string, w: number): Promise<{count:number;resetAt:number}>; get(k: string): Promise<null>; reset(k: string): Promise<void> }
export declare function createRateLimiterWeb(c: RateLimitConfig): (ip: string) => RateLimitResult
export declare function createDurableRateLimiterWeb(c: RateLimitConfig, o: { store: RateLimitStore }): (ip: string) => Promise<RateLimitResult>
`
    const dir = join(workspace, 'control')
    mkdirSync(join(dir, 'src'), { recursive: true })
    writeFileSync(join(dir, 'src', 'stubs.ts'), stubs)
    writeFileSync(join(dir, 'src', 'entry.ts'), entryWithStubbedImports())
    writeFileSync(
      join(dir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          noEmit: true,
          module: 'esnext',
          moduleResolution: 'bundler',
          target: 'es2022',
          skipLibCheck: true,
        },
        include: ['src/**/*.ts'],
      }),
    )
    let ok = true
    let output = ''
    try {
      execFileSync(TSC, ['--noEmit', '-p', dir], { encoding: 'utf8', stdio: 'pipe' })
    } catch (error) {
      ok = false
      const e = error as { stdout?: string }
      output = e.stdout ?? ''
    }
    expect(
      ok,
      `the control fixture does not typecheck, so the mutation below proves nothing:\n${output}`,
    ).toBe(true)
  })

  it('test_removing_the_durable_import_fails_the_typecheck_naming_the_symbol', () => {
    const mutated = entryWithStubbedImports().replace(
      /import \{ createDurableRateLimiterWeb \} from '\.\/stubs\.js'\n/,
      '',
    )
    expect(
      mutated,
      'the mutation did not apply — the import line is not shaped as the regex expects',
    ).not.toContain('import { createDurableRateLimiterWeb }')

    const dir = join(workspace, 'mutated')
    mkdirSync(join(dir, 'src'), { recursive: true })
    writeFileSync(
      join(dir, 'src', 'stubs.ts'),
      readFileSync(join(workspace, 'control', 'src', 'stubs.ts'), 'utf8'),
    )
    writeFileSync(join(dir, 'src', 'entry.ts'), mutated)
    writeFileSync(
      join(dir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          noEmit: true,
          module: 'esnext',
          moduleResolution: 'bundler',
          target: 'es2022',
          skipLibCheck: true,
        },
        include: ['src/**/*.ts'],
      }),
    )
    let output = ''
    let failed = false
    try {
      execFileSync(TSC, ['--noEmit', '-p', dir], { encoding: 'utf8', stdio: 'pipe' })
    } catch (error) {
      failed = true
      const e = error as { stdout?: string }
      output = e.stdout ?? ''
    }

    expect(
      failed,
      'deleting the import produced no compile error — the file left the typecheck',
    ).toBe(true)
    expect(
      output,
      'the compiler failed but did not name the symbol, so the error is about something else',
    ).toContain('createDurableRateLimiterWeb')
  })
})
