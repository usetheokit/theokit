import { readFileSync, statSync } from 'node:fs'
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

  it('exits 2 on duplicate, invalid name and unknown tool', async () => {
    const v = harness()
    expect(await runCli(['mcp-relay', 'grant', 'a'], v.io)).toBe(0)
    expect(await runCli(['mcp-relay', 'grant', 'a'], v.io)).toBe(2)
    expect(await runCli(['mcp-relay', 'grant', 'bad name!'], v.io)).toBe(2)
    expect(await runCli(['mcp-relay', 'grant', 'b', '--tools', 'nope'], v.io)).toBe(2)
    expect(await runCli(['mcp-relay', 'grant', 'c', '--tools', 'write_file'], v.io)).toBe(0)
  })
})
