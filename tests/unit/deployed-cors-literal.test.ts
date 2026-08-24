/**
 * The CORS a deployed target carries, and the one it refuses to pretend it carries
 * (usetheokit/theokit#409).
 *
 * `security.cors` reached one consumer — Vite's `configureServer` hook — so an app that worked
 * cross-origin under `theokit dev` stopped working on every deploy target, with no error and no
 * warning. Carrying it means writing it into the emitted entry, and two of the shapes the schema
 * accepts do not survive a naive serialisation:
 *
 * - a **RegExp** rendered by `JSON.stringify` becomes `{}`, and `matchesOrigin` checks
 *   `instanceof RegExp` — so it would sit in the emitted file looking configured and matching
 *   nothing, which is this issue's own defect one layer down;
 * - a **callback** has no literal at all, and baking only the serialisable shapes would produce an
 *   app whose CORS silently allows nothing.
 *
 * The first is emitted as a regex literal. The second is REFUSED at build time, per
 * `rules/three-target-parity.md` § 3 — "a target that cannot serve a capability refuses by name".
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

import {
  renderDeployedCorsLiteral,
  UnserializableCorsOriginError,
} from '../../packages/theo/src/adapters/deployed-cors.js'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** Evaluate the emitted literal as module source — a plausible-looking string cannot pass. */
async function evaluated(literal: string): Promise<Record<string, unknown> | undefined> {
  const dir = mkdtempSync(join(tmpdir(), 'theo-cors-literal-'))
  dirs.push(dir)
  const file = join(dir, 'literal.mjs')
  writeFileSync(file, `export default ${literal}\n`, 'utf8')
  const mod = (await import(pathToFileURL(file).href)) as {
    default: Record<string, unknown> | undefined
  }
  return mod.default
}

const BASE = { credentials: false, maxAge: 600 } as const

describe('the deployed entry carries the configured CORS (#409)', () => {
  it('emits nothing to configure when the app declared no cors block', async () => {
    expect(await evaluated(renderDeployedCorsLiteral(undefined, 'vercel'))).toBeUndefined()
  })

  it('carries a plain origin', async () => {
    const value = await evaluated(
      renderDeployedCorsLiteral({ ...BASE, origins: 'https://other.example' }, 'vercel'),
    )

    expect(value?.origins).toBe('https://other.example')
    expect(value?.maxAge).toBe(600)
  })

  it('keeps a RegExp origin a RegExp, so it still matches', async () => {
    const value = await evaluated(
      renderDeployedCorsLiteral({ ...BASE, origins: /^https:\/\/.*\.example$/u }, 'vercel'),
    )

    expect(value?.origins).toBeInstanceOf(RegExp)
    expect((value?.origins as RegExp).test('https://app.example')).toBe(true)
  })

  it('carries a mixed array without flattening the RegExp into an object', async () => {
    const value = await evaluated(
      renderDeployedCorsLiteral({ ...BASE, origins: ['https://a.example', /b\.example$/u] }, 'bun'),
    )

    const origins = value?.origins as unknown[]
    expect(origins[0]).toBe('https://a.example')
    expect(origins[1]).toBeInstanceOf(RegExp)
  })

  it('refuses a callback origin by name, instead of dropping it', () => {
    // Baking only the serialisable shapes would deploy an app whose CORS allows nothing — the same
    // silence this issue reports, produced by the fix for it.
    expect(() => renderDeployedCorsLiteral({ ...BASE, origins: () => true }, 'cloudflare')).toThrow(
      UnserializableCorsOriginError,
    )
  })

  it('names the target and both ways forward in the refusal', () => {
    let message = ''
    try {
      renderDeployedCorsLiteral({ ...BASE, origins: () => true }, 'cloudflare')
    } catch (err) {
      message = (err as Error).message
    }

    expect(message).toContain('cloudflare')
    // The two real options: a shape that travels, or the target that evaluates the callback.
    expect(message).toContain('RegExp')
    expect(message).toContain('theokit start')
  })
})
