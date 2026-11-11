import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'

import { pathCommand } from '../src/ops/oc-path.js'

describe('theoclaw path', () => {
  it('resolves, finds, sets and validates sections and leaves', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ocpath-'))
    mkdirSync(join(dir, 'ws'))
    writeFileSync(join(dir, 'ws', 'AGENTS.md'), '# Top\n\n## Rules\nBe kind.\n\n### Style\nShort.\n\n## Other\nx\n')
    writeFileSync(join(dir, 'ws', 'c.json'), '{"a":{"b":[1,20000]}}')
    const env = { THEOCLAW_WORKSPACE: join(dir, 'ws') }
    const run = async (...args: string[]): Promise<string> => {
      const stdout = new PassThrough()
      let out = ''
      stdout.on('data', (c) => (out += String(c)))
      expect(await pathCommand(args, { env: { ...env }, homeDir: dir, cwd: dir, stdout, stderr: new PassThrough() })).toBe(0)
      return out
    }
    expect(await run('resolve', 'oc://main/AGENTS.md#Rules')).toBe('## Rules\nBe kind.\n\n### Style\nShort.\n')
    expect(await run('resolve', 'oc://main/AGENTS.md#rules/style')).toBe('### Style\nShort.\n')
    expect(await run('resolve', 'oc://main/c.json#a.b.1')).toBe('20000\n')
    expect(await run('find', 'oc://main/AGENTS.md#sty')).toBe('oc://main/AGENTS.md#Top/Rules/Style\n')
    expect(await run('set', 'oc://main/AGENTS.md#Other', 'y', '--dry-run')).toContain('## Other\n\ny\n')
    expect(readFileSync(join(dir, 'ws', 'AGENTS.md'), 'utf8')).toContain('x\n')
    await run('set', 'oc://main/c.json#a.b.0', '7')
    expect(JSON.parse(readFileSync(join(dir, 'ws', 'c.json'), 'utf8')).a.b[0]).toBe(7)
    expect(await run('validate', 'oc://main/AGENTS.md#Rules')).toContain('ok')
    await expect(run('resolve', 'oc://main/../x#a')).rejects.toThrow(/inside/)
    await expect(run('resolve', 'oc://main/AGENTS.md#Nope')).rejects.toThrow(/no section/)
  })
})
