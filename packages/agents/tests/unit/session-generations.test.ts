import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createSessionGenerations } from '../../src/session/index.js'

const file = () => join(mkdtempSync(join(tmpdir(), 'gen-')), 'generations.json')

describe('createSessionGenerations', () => {
  it('survives a restart and never repeats a value', async () => {
    const f = file()
    const a = createSessionGenerations(f)
    expect(await a.current('k')).toBe(0)
    expect(await a.next('k')).toBe(1)
    const b = createSessionGenerations(f)
    expect(await b.current('k')).toBe(1)
    expect(await b.next('k')).toBe(2)
    expect(await b.next('other')).toBe(1)
  })

  it('is unique across concurrent instances', async () => {
    const f = file()
    const got = await Promise.all(
      Array.from({ length: 8 }, () => createSessionGenerations(f).next('k')),
    )
    expect(new Set(got).size).toBe(8)
  })

  it('refuses a malformed file', async () => {
    const f = file()
    writeFileSync(f, '{"k":"x"}')
    await expect(createSessionGenerations(f).next('k')).rejects.toThrow(/invalid counter/)
  })
})
