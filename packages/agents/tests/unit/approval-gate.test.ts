import { mkdirSync, mkdtempSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { createApprovalGate } from '../../src/auth/approval-gate.js'
import { createJsonlLedger, type ApprovalLedger } from '../../src/auth/approval-ledger.js'
import { PermissionStore } from '../../src/auth/permission-store.js'

function fixture(): { store: PermissionStore; scope: string; dir: string } {
  const home = mkdtempSync(join(tmpdir(), 'approval-gate-'))
  const scope = join(home, 'repo')
  mkdirSync(scope)
  return { store: new PermissionStore({ home }), scope, dir: join(home, 'ledger') }
}
const ctx = (command: string): any => ({
  name: 'shell_exec',
  args: { command },
  agentId: 'a',
  runId: 'r',
})
const keyFor = (scope: string) => (c: any) => ({
  tool: c.name as string,
  scope,
  command: c.args.command as string,
})

afterEach(() => {
  vi.useRealTimers()
})

describe('createApprovalGate', () => {
  it('the chain runs waiver, saved, reviewer, person in that order', async () => {
    const { store, scope } = fixture()
    const calls: string[] = []
    const reviewer = vi.fn(() => {
      calls.push('reviewer')
      return Promise.resolve('ask' as const)
    })
    const ask = vi.fn(() => {
      calls.push('ask')
      return Promise.resolve('once' as const)
    })
    let waived = true
    const gate = createApprovalGate({
      store,
      key: keyFor(scope),
      waived: () => waived,
      reviewer,
      ask,
    })
    expect((await gate.decide(ctx('ls'))).by).toBe('waiver')
    expect(calls).toEqual([])
    waived = false
    store.grant({ tool: 'shell_exec', scope, command: 'ls' })
    expect((await gate.decide(ctx('ls'))).by).toBe('saved')
    expect(calls).toEqual([])
    expect((await gate.decide(ctx('pwd'))).by).toBe('person')
    expect(calls).toEqual(['reviewer', 'ask'])
    reviewer.mockResolvedValueOnce('allow' as never)
    expect((await gate.decide(ctx('id'))).by).toBe('reviewer')
    reviewer.mockResolvedValueOnce('deny' as never)
    const denied = await gate.decide(ctx('rm'))
    expect(denied).toMatchObject({ allowed: false, by: 'reviewer' })
    expect(ask).toHaveBeenCalledTimes(1)
  })

  it('an always answer is saved and the next identical call is allowed without asking', async () => {
    const { store, scope } = fixture()
    const ask = vi.fn(() => Promise.resolve({ answer: 'always' as const, by: 'ana' }))
    const gate = createApprovalGate({ store, key: keyFor(scope), ask })
    expect(await gate.decide(ctx('make'))).toMatchObject({ allowed: true, by: 'person:ana' })
    expect(store.isGranted({ tool: 'shell_exec', scope, command: 'make' })).toBe(true)
    expect((await gate.decide(ctx('make'))).by).toBe('saved')
    expect(ask).toHaveBeenCalledTimes(1)
  })

  it('a person who does not answer within timeoutMs denies the call', async () => {
    vi.useFakeTimers()
    const { store, scope } = fixture()
    const gate = createApprovalGate({
      store,
      key: keyFor(scope),
      ask: () => new Promise(() => undefined),
      timeoutMs: 1000,
    })
    const p = gate.decide(ctx('ls'))
    await vi.advanceTimersByTimeAsync(1000)
    expect(await p).toMatchObject({ allowed: false })
    expect((await p).reason).toMatch(/no answer within 1000ms/)
  })

  it('a reviewer that throws defers to the person and reports onError with stage reviewer', async () => {
    const { store, scope } = fixture()
    const onError = vi.fn()
    const gate = createApprovalGate({
      store,
      key: keyFor(scope),
      reviewer: () => Promise.reject(new Error('boom')),
      ask: () => Promise.resolve('once'),
      onError,
    })
    const d = await gate.decide(ctx('ls'))
    expect(d).toMatchObject({ allowed: true, by: 'person' })
    expect(d.reason).toMatch(/reviewer/)
    expect(onError).toHaveBeenCalledWith(expect.any(Error), 'reviewer')
  })

  it('reports ask and save failures and still fails closed or keeps the one-time approval', async () => {
    const { store, scope } = fixture()
    const onError = vi.fn()
    const failing = createApprovalGate({
      store,
      key: keyFor(scope),
      ask: () => Promise.reject(new Error('x')),
      onError,
    })
    const denied = await failing.decide(ctx('ls'))
    expect(denied.allowed).toBe(false)
    expect(denied.reason).toMatch(/ask/)
    expect(onError).toHaveBeenCalledWith(expect.any(Error), 'ask')
    vi.spyOn(store, 'grant').mockImplementation(() => {
      throw new Error('disk')
    })
    const saving = createApprovalGate({
      store,
      key: keyFor(scope),
      ask: () => Promise.resolve('always'),
      onError,
    })
    const d = await saving.decide(ctx('ls'))
    expect(d.allowed).toBe(true)
    expect(d.reason).toMatch(/save/)
    expect(onError).toHaveBeenCalledWith(expect.any(Error), 'save')
  })

  it('with no asker an ungranted call is denied with reason nobody can approve it', async () => {
    const { store, scope } = fixture()
    const d = await createApprovalGate({ store, key: keyFor(scope) }).decide(ctx('ls'))
    expect(d).toMatchObject({ allowed: false, by: 'none' })
    expect(d.reason).toContain('nobody can approve it')
  })

  it('every decision appends one ledger line with by, allowed and reason', async () => {
    const { store, scope, dir } = fixture()
    const ledger = createJsonlLedger(dir)
    const gate = createApprovalGate({
      store,
      key: keyFor(scope),
      ask: () => Promise.resolve('deny'),
      ledger,
    })
    await gate.decide(ctx('ls'))
    await gate.decide(ctx('pwd'))
    const lines = await ledger.read()
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatchObject({
      decidedBy: 'person',
      allowed: false,
      tool: 'shell_exec',
      runId: 'r',
    })
    expect(lines[0]?.reason).toBeTruthy()
    expect(statSync(join(dir, 'activity.jsonl')).mode & 0o777).toBe(0o600)
  })

  it('a ledger write failure still returns the decision and reports onError with stage ledger', async () => {
    const { store, scope } = fixture()
    const onError = vi.fn()
    const ledger: ApprovalLedger = { append: () => Promise.reject(new Error('full')) }
    const gate = createApprovalGate({
      store,
      key: keyFor(scope),
      ask: () => Promise.resolve('once'),
      ledger,
      onError,
    })
    const d = await gate.decide(ctx('ls'))
    expect(d).toMatchObject({ allowed: true, by: 'person' })
    expect(d.reason).toMatch(/ledger/)
    expect(onError).toHaveBeenCalledWith(expect.any(Error), 'ledger')
  })

  it('the plugin vetoes a denied call and passes an ungoverned one', async () => {
    const { store } = fixture()
    const gate = createApprovalGate({ store, key: () => undefined })
    let handler: ((c: unknown) => Promise<unknown>) | undefined
    ;(gate.plugin as any).register({ on: (_h: string, fn: any) => (handler = fn) })
    expect(await handler?.(ctx('ls'))).toBeUndefined()
    const strict = createApprovalGate({
      store,
      key: () => ({ tool: 't', scope: tmpdir(), command: 'x' }),
    })
    ;(strict.plugin as any).register({ on: (_h: string, fn: any) => (handler = fn) })
    expect(await handler?.(ctx('ls'))).toMatchObject({ block: true })
  })

  it('denies a malformed answer from the asker', async () => {
    const { store, scope } = fixture()
    for (const bad of ['yes', { answer: 'ok', by: 'x' }, {}, null]) {
      const gate = createApprovalGate({
        store,
        key: keyFor(scope),
        ask: () => Promise.resolve(bad as never),
      })
      expect((await gate.decide(ctx('ls'))).allowed).toBe(false)
    }
  })

  it('receipts an ungoverned call and a classification failure', async () => {
    const { store, dir } = fixture()
    const ledger = createJsonlLedger(dir)
    await createApprovalGate({ store, key: () => undefined, ledger }).decide(ctx('ls'))
    const failing = createApprovalGate({
      store,
      key: () => {
        throw new Error('bad key')
      },
      ledger,
    })
    expect((await failing.decide(ctx('ls'))).allowed).toBe(false)
    const lines = await ledger.read()
    expect(lines.map((l) => l.allowed)).toEqual([true, false])
    expect(lines[1]?.reason).toMatch(/bad key/)
  })
})
