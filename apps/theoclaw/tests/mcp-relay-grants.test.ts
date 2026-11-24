import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { runCli } from '../src/cli.js'
import { GrantStore, grantsPath } from '../src/mcp-relay/grants.js'
import { harness } from './support/cli-harness.js'

describe('mcp-relay', () => {
  it('grants, authenticates, lists and revokes', async () => {
    const v = harness()
    expect(await runCli(['mcp-relay', 'grant', 'chatgpt'], v.io)).toBe(0)
    const token = /token \(shown once\): (\S+)/.exec(v.stdout())![1]!
    const path = grantsPath(v.io.env, v.io.homeDir)
    const raw = readFileSync(path, 'utf8')
    expect(raw).not.toContain(token)
    expect(raw).toContain('tokenHash')
    expect(statSync(path).mode & 0o777).toBe(0o600)
    const store = new GrantStore(path).load()
    expect(store.authenticate(token)?.tools).toEqual(['list_dir', 'read_file'])
    expect(store.authenticate('wrong')).toBeUndefined()

    const l = harness()
    const out = { ...v.io, stdout: l.io.stdout }
    expect(await runCli(['mcp-relay', 'list'], out)).toBe(0)
    expect(l.stdout()).toContain('chatgpt')
    expect(l.stdout()).not.toContain(token)
    expect(l.stdout()).not.toContain(store.list()[0]!.tokenHash)

    expect(await runCli(['mcp-relay', 'revoke', 'chatgpt'], v.io)).toBe(0)
    expect(new GrantStore(path).load().authenticate(token)).toBeUndefined()
  })

  it('keeps every change when separate CLI commands mutate at once', async () => {
    const v = harness()
    expect(await runCli(['mcp-relay', 'grant', 'first'], v.io)).toBe(0)
    const path = grantsPath(v.io.env, v.io.homeDir)
    const run = (...args: string[]) => runCli(['mcp-relay', ...args], { ...v.io, stdout: harness().io.stdout })
    const codes = await Promise.all([run('revoke', 'first'), run('grant', 'second'), run('grant', 'third')])
    expect(codes).toEqual([0, 0, 0])
    const byName = new Map(new GrantStore(path).load().list().map((g) => [g.name, g]))
    expect(byName.get('first')?.revokedAt).toBeDefined()
    expect(byName.get('second')?.revokedAt).toBeUndefined()
    expect(byName.get('third')?.revokedAt).toBeUndefined()
  })

  it('exits 2 on duplicate, invalid name and unknown tool', async () => {
    const v = harness()
    expect(await runCli(['mcp-relay', 'grant', 'a'], v.io)).toBe(0)
    expect(await runCli(['mcp-relay', 'grant', 'a'], v.io)).toBe(2)
    expect(await runCli(['mcp-relay', 'grant', 'bad name!'], v.io)).toBe(2)
    expect(await runCli(['mcp-relay', 'grant', 'b', '--tools', 'nope'], v.io)).toBe(2)
    expect(await runCli(['mcp-relay', 'grant', 'c', '--tools', 'write_file'], v.io)).toBe(0)
  })

  it('smoke runs list_dir through the relay and the connector', async () => {
    const v = harness()
    expect(await runCli(['mcp-relay', 'smoke'], v.io)).toBe(0)
    expect(v.stdout()).toContain('mcp-relay smoke: ok')
  })

  it('keeps every grant when two processes write the same file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'theoclaw-grants-'))
    try {
      const path = join(dir, 'state', 'grants.json')
      const writer = fileURLToPath(new URL('./support/grants-writer.ts', import.meta.url))
      const run = (prefix: string): Promise<number | null> =>
        new Promise((done, fail) => {
          const child = spawn(process.execPath, ['--import', 'tsx', writer, path, prefix, '50'], {
            cwd: fileURLToPath(new URL('..', import.meta.url)),
            stdio: 'inherit',
          })
          child.on('error', fail)
          child.on('exit', done)
        })
      expect(await Promise.all([run('a'), run('b')])).toEqual([0, 0])
      const names = new GrantStore(path).load().list().map((g) => g.name)
      expect(new Set(names).size).toBe(100)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 120_000)
})
