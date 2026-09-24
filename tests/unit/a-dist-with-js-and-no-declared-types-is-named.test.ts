/**
 * A `dist` carrying JavaScript and none of its declared type entries must be NAMED, and named
 * against the package whose DTS is incomplete.
 *
 * ## The measurement this exists for (2026-09-24)
 *
 * `packages/theo/tsup.config.ts:74` builds with `clean: true`, so the previous `.d.ts` files are
 * removed before the DTS worker writes the new ones — and that worker is the expensive step (73,193
 * ms and a large heap for `packages/theo`). A clean `pnpm build:packages` taken by SIGTERM leaves
 * `packages/theo/dist` with 201 `.js` files and 0 `.d.ts`.
 *
 * Nothing named that state. Measured in this worktree against a deliberately poisoned dist:
 *
 *     tsc --noEmit -p packages/tauri/tsconfig.json   → exit 2
 *     src/sidecar.ts(7,8): error TS7016: Could not find a declaration file for module
 *                          'theokit/server/agent'
 *
 * The error is LOCATED at the consumer's source, which did not change. `packages/tauri/tsconfig.json`
 * declares no `paths`, so it resolves `theokit` through the workspace symlink
 * (`packages/tauri/node_modules/theokit → ../../theo`) and reads the `exports` of `packages/theo`,
 * every entry of which points into `dist`. The ROOT typecheck is immune — `tsconfig.json` maps
 * `theokit/*` to `packages/theo/src`, measured at TS7016 = 0 — so `pnpm typecheck:only` never
 * surfaces this and the poisoned dist survives silently, `dist` being gitignored.
 *
 * That misattribution already cost a wrong diagnosis: B-290 was filed against build ORDERING on the
 * strength of this symptom, and the ordering was measured to be correct.
 *
 * ## Why the check reads the DECLARED surface and not "are there any .d.ts"
 *
 * Measured the same day: `packages/create-theokit/dist` holds 1 `.js` and 0 `.d.ts`, and that is
 * CORRECT — it declares no `types` field and no `types` condition in `exports`; it is a pure `bin`.
 * A guard asking "js but no d.ts" reports it on every run forever, and a gate that is wrong every
 * time is a gate somebody switches off.
 */
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import {
  auditPackageDts,
  auditWorkspaceDts,
  describeDtsFinding,
  declaredTypeEntries,
} from '../../scripts/lib/dts-completeness.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../..')

let sandbox: string

/** A package whose `exports` declare types, plus the emitted JS and `.d.ts` that satisfy them. */
const writeCompletePackage = (dir: string, name: string): void => {
  mkdirSync(join(dir, 'dist', 'server'), { recursive: true })
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({
      name,
      exports: {
        '.': { types: './dist/index.d.ts', import: './dist/index.js' },
        './server': { types: './dist/server/index.d.ts', import: './dist/server/index.js' },
      },
    }),
  )
  for (const stem of ['index', 'server/index']) {
    writeFileSync(join(dir, 'dist', `${stem}.js`), 'export const x = 1\n')
    writeFileSync(join(dir, 'dist', `${stem}.d.ts`), 'export declare const x: number\n')
  }
}

beforeEach(() => {
  sandbox = join(REPO_ROOT, 'node_modules', '.tmp-dts-completeness', String(process.pid))
  mkdirSync(sandbox, { recursive: true })
})

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true })
})

describe('a dist carrying JS and no declared types', () => {
  it('reports complete when every declared type entry is on disk', () => {
    const dir = join(sandbox, 'complete')
    writeCompletePackage(dir, 'pkg-complete')

    const verdict = auditPackageDts(dir)

    expect(verdict.kind).toBe('complete')
  })

  it('names the package when the declared type entries were stripped from a dist that still has JS', () => {
    const dir = join(sandbox, 'stripped')
    writeCompletePackage(dir, 'pkg-stripped')
    rmSync(join(dir, 'dist', 'index.d.ts'))
    rmSync(join(dir, 'dist', 'server', 'index.d.ts'))

    const verdict = auditPackageDts(dir)

    expect(verdict.kind).toBe('types-missing')
    expect(verdict.pkg).toBe('pkg-stripped')
    if (verdict.kind !== 'types-missing') throw new Error('narrowing')
    expect(verdict.missing).toEqual(['./dist/index.d.ts', './dist/server/index.d.ts'])
    expect(verdict.jsFiles).toBe(2)
  })

  it('reports a partially stripped dist, because one missing entry is one unusable subpath', () => {
    const dir = join(sandbox, 'partial')
    writeCompletePackage(dir, 'pkg-partial')
    rmSync(join(dir, 'dist', 'server', 'index.d.ts'))

    const verdict = auditPackageDts(dir)

    expect(verdict.kind).toBe('types-missing')
    if (verdict.kind !== 'types-missing') throw new Error('narrowing')
    expect(verdict.missing).toEqual(['./dist/server/index.d.ts'])
  })

  it('does not fail a package that declares no types at all, which is what a pure bin looks like', () => {
    const dir = join(sandbox, 'bin-only')
    mkdirSync(join(dir, 'dist'), { recursive: true })
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'pkg-bin', bin: { 'pkg-bin': './dist/cli.js' } }),
    )
    writeFileSync(join(dir, 'dist', 'cli.js'), '#!/usr/bin/env node\n')

    const verdict = auditPackageDts(dir)

    expect(verdict.kind).toBe('types-not-declared')
  })

  it('does not fail a package that was never built, because nothing was emitted to be incomplete', () => {
    const dir = join(sandbox, 'unbuilt')
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({
        name: 'pkg-unbuilt',
        exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js' } },
      }),
    )

    const verdict = auditPackageDts(dir)

    expect(verdict.kind).toBe('not-built')
  })

  it('reads the top-level types field as well as the exports conditions', () => {
    expect(
      declaredTypeEntries({
        types: './dist/index.d.ts',
        exports: { './wire': { types: './dist/wire/index.d.ts' } },
      }),
    ).toEqual(['./dist/index.d.ts', './dist/wire/index.d.ts'])
  })
})

const FINDING = {
  kind: 'types-missing',
  pkg: 'theokit',
  dir: 'packages/theo',
  declared: 28,
  missing: ['./dist/server/agent/index.d.ts'],
  jsFiles: 201,
} as const

describe('what the guard reports', () => {
  it('names the package whose DTS is incomplete, not the consumer that would be blamed', () => {
    const message = describeDtsFinding({
      kind: 'types-missing',
      pkg: 'theokit',
      dir: 'packages/theo',
      declared: 28,
      missing: ['./dist/server/agent/index.d.ts'],
      jsFiles: 201,
    })

    expect(message).toContain('theokit')
    expect(message).toContain('packages/theo')
    expect(message).toContain('201')
  })

  it('clears the consumer, whose source is what a later typecheck would blame', () => {
    const message = describeDtsFinding(FINDING)

    expect(message).toMatch(/not a type error|NOTHING is wrong|did not change|not implicated/i)
    expect(message).toContain('TS7016')
  })

  /**
   * Measured 2026-09-24, and it corrected this message. An earlier draft asserted the cause was a
   * SIGTERM. Then a real `pnpm --filter theokit build` in this worktree exited **1** with
   * `DTS Build error` and `TS2307: Cannot find module '@theokit/agents/config'` -- because that
   * workspace dependency was not built yet -- and left **201 `.js` and 0 `.d.ts`**: byte for byte
   * the shape the kill produces.
   *
   * So the artifact cannot tell the two apart, and a guard that names one of them is a guard that
   * misattributes half the time -- the defect this item exists to remove, pointed the other way.
   */
  it('names BOTH causes of the shape, because the artifact cannot tell them apart', () => {
    const message = describeDtsFinding(FINDING)

    expect(message).toMatch(/killed/i)
    expect(message).toMatch(/143/)
    expect(message).toMatch(/failed/i)
    // The genuine-failure cause, measured: an unbuilt workspace dependency.
    expect(message).toMatch(/TS2307|not built|dependency/i)
  })

  it('does not assert a single cause it cannot observe from the filesystem', () => {
    const message = describeDtsFinding(FINDING)

    // It may not say the build WAS killed; only that a kill is one of the two things that do this.
    expect(message).not.toMatch(/the DTS build did not finish -- this repository/i)
    expect(message).toMatch(/cannot tell you why|cannot tell which|either/i)
  })

  it('points the reader at the exit code, which is the thing that does distinguish them', () => {
    const message = describeDtsFinding(FINDING)

    expect(message).toMatch(/exit code|exit 1|exit 143/i)
  })
})

describe('against this repository as it stands', () => {
  it('does not report create-theokit, which declares zero type entries on purpose', () => {
    const dir = join(REPO_ROOT, 'packages', 'create-theokit')

    // The load-bearing fact, asserted directly: it promises no types, so its dist holding 1 `.js`
    // and 0 `.d.ts` (measured 2026-09-24) is correct rather than poisoned. Asserting only on the
    // verdict would pass for the wrong reason in a checkout where nothing has been built yet.
    const manifest: unknown = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    expect(declaredTypeEntries(manifest)).toEqual([])
    expect(auditPackageDts(dir).kind).not.toBe('types-missing')
  })

  it('holds theokit to the 28 type entries it declares, so the guard has a real subject here', () => {
    const manifest: unknown = JSON.parse(
      readFileSync(join(REPO_ROOT, 'packages', 'theo', 'package.json'), 'utf8'),
    )

    const declared = declaredTypeEntries(manifest)

    expect(declared.length).toBeGreaterThan(20)
    expect(declared).toContain('./dist/server/agent/index.d.ts')
  })

  it('audits every workspace package under packages/ without throwing', () => {
    const findings = auditWorkspaceDts(REPO_ROOT)

    expect(findings.length).toBeGreaterThan(0)
    expect(findings.map((f) => f.pkg)).toContain('theokit')
  })
})

describe('the check is wired where a build happens', () => {
  it('is declared as a script, so a developer who just met TS7016 has one command to run', () => {
    const manifest: unknown = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'))
    const scripts = (manifest as { scripts: Record<string, string> }).scripts

    expect(scripts['check:dts-complete']).toContain('check-dts-complete')
  })

  it('runs in pre-push AFTER the build, because before it the state is one the build will fix', () => {
    const hook = readFileSync(join(REPO_ROOT, '.githooks', 'pre-push'), 'utf8')

    const buildAt = hook.indexOf('pnpm build:packages || build_status=$?')
    const checkAt = hook.indexOf('pnpm check:dts-complete || dts_status=$?')

    expect(buildAt).toBeGreaterThan(-1)
    expect(checkAt).toBeGreaterThan(-1)
    expect(checkAt).toBeGreaterThan(buildAt)
  })

  /**
   * What the stage PRINTS, and what a kill prints, are asserted by EXECUTING the hook in
   * `pre-push-says-killed-not-failed.test.ts`, which already owns that harness and that distinction.
   * Duplicating those assertions as text matches here would be two copies of one piece of knowledge,
   * and the weaker copy is the one that keeps passing after the behaviour changes.
   */
})
