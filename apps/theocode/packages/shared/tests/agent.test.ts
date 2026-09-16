/**
 * B-002 — the product has one name, and it is the one the user sees.
 *
 * The repository calls itself TheoCode everywhere that is a CONTRACT (package.json, NOTICE, both bin
 * entries, README, and the commit that renamed it) and "Theokit Builder" everywhere that is SPEECH:
 * the system prompt, the greeting, the banner, the composer placeholder, and the dialog that asks
 * for filesystem and command-execution permission.
 *
 * It also claimed to run on `@theokit/sdk` while importing `@theokit/agents` 82 times and
 * `@theokit/sdk` zero times — so the agent stated, with confidence, a fact about itself that was
 * false.
 *
 * `AGENT` already exists as the single source of truth. The defect is that five call sites declare
 * their own literal instead of reading it, which is why fixing the constant alone would not fix the
 * product. The scan below is therefore part of the contract, not decoration: it is what stops the
 * sixth copy from being added.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { AGENT } from '../src/agent.js'

const PACKAGES = join(import.meta.dirname, '..', '..')

/** Every `.ts`/`.tsx` under `packages/`, excluding build output and this test's own fixtures. */
function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) sourceFiles(full, found)
    else if (/\.tsx?$/.test(entry) && !entry.endsWith('.test.ts') && !entry.endsWith('.test.tsx'))
      found.push(full)
  }
  return found
}

describe('the version the product shows is the version it IS', () => {
  it('test_the_declared_version_matches_the_root_manifest', () => {
    const manifest = JSON.parse(readFileSync(join(PACKAGES, '..', 'package.json'), 'utf8')) as {
      version: string
    }

    expect(
      AGENT.version,
      'AGENT.version is what the welcome banner prints. It is a literal because `packages/shared` ' +
        'cannot import the root manifest without breaking the bundle, so THIS test is the only ' +
        'thing keeping the two in step — a release that bumps package.json and forgets this ' +
        'constant ships a build that misreports itself.',
    ).toBe(manifest.version)
  })
})

describe('B-002 — the agent identifies itself as TheoCode', () => {
  it('test_the_agent_name_is_TheoCode', () => {
    expect(AGENT.name).toBe('TheoCode')
  })

  it('test_the_greeting_does_not_carry_the_old_product_name', () => {
    expect(
      AGENT.greeting,
      'the greeting is printed verbatim at session start — it is the first thing the user reads',
    ).not.toMatch(/Theokit Builder/)
  })

  it('test_the_agent_does_not_claim_to_run_on_a_sdk_it_does_not_import', () => {
    // Measured: 82 imports of `@theokit/agents`, 0 of `@theokit/sdk`.
    expect(
      AGENT.greeting,
      'the greeting names `@theokit/sdk`, which this codebase never imports. Stating a false fact ' +
        'about itself is worse than stating none.',
    ).not.toMatch(/@theokit\/sdk/)
  })

  it('test_no_source_file_hard_codes_the_old_product_name', () => {
    const offenders = sourceFiles(PACKAGES)
      .filter((f) => readFileSync(f, 'utf8').includes('Theokit Builder'))
      .map((f) => f.replace(`${PACKAGES}/`, ''))

    expect(
      offenders,
      'these files declare the product name as a literal instead of reading `AGENT.name`. That is ' +
        'how the rename left four rendered surfaces behind — including the consent dialog, which ' +
        'asked for filesystem and command permission in the name of a product that does not exist.',
    ).toEqual([])
  })
})
