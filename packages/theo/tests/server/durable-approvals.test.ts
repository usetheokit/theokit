import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { handleAgentApproval, type ResumeApproval } from '../../src/server/agent/approve-agent.js'
import { handleListDurableApprovals } from '../../src/server/agent/list-approvals-handler.js'
import {
  createDurableApprovalRegistry,
  createFileApprovalStore,
  type StoredApproval,
} from '../../src/server/agent/approval-store.js'

const dirs: string[] = []
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'approvals-'))
  dirs.push(d)
  return d
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

const record = (over: Partial<StoredApproval> = {}): StoredApproval => ({
  schemaVersion: 1,
  approvalId: 'a-1',
  agentName: 'chat',
  sessionId: 's-1',
  toolUseId: 'tu-1',
  toolName: 'deploy',
  expiresAt: Date.now() + 60_000,
  onTimeout: 'abort',
  ...over,
})

function approve(
  registry: ReturnType<typeof createDurableApprovalRegistry>,
  body: unknown,
  resume?: ResumeApproval,
) {
  const request = new Request('http://x/api/agents/chat/approve/a-1', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return handleAgentApproval(request, '/api/agents/chat/approve/a-1', registry, 'off', { resume })
}

describe('durable approvals', () => {
  it('pending_approval_survives_a_restart', async () => {
    const dir = tmp()
    await createFileApprovalStore(dir).put(record())
    expect(statSync(join(dir, 'a-1.json')).mode & 0o777).toBe(0o600)

    // "restart": a brand-new store and registry over the same dir.
    const registry = createDurableApprovalRegistry(createFileApprovalStore(dir))
    const listed = (await (
      await handleListDurableApprovals(registry, undefined, 'chat')
    ).json()) as {
      approvals: { approvalId: string }[]
    }
    expect(listed.approvals.map((a) => a.approvalId)).toEqual(['a-1'])

    const calls: unknown[] = []
    const res = await approve(registry, { approved: true }, (r, d) => {
      calls.push([r.sessionId, d])
      return new Response('stream')
    })
    expect(await res.text()).toBe('stream')
    expect(calls).toEqual([['s-1', { toolUseId: 'tu-1', behavior: 'allow' }]])
    // used once: the id is gone
    expect((await approve(registry, { approved: true }, () => new Response('x'))).status).toBe(404)
  })

  it('deny_after_restart_reaches_the_model', async () => {
    const dir = tmp()
    await createFileApprovalStore(dir).put(record())
    const registry = createDurableApprovalRegistry(createFileApprovalStore(dir))
    let seen: unknown
    await approve(registry, { approved: false, reason: 'no' }, (_r, d) => {
      seen = d
      return new Response('')
    })
    expect(seen).toEqual({ toolUseId: 'tu-1', behavior: 'deny', message: 'no' })
  })

  it('expired_durable_approval_applies_on_timeout', async () => {
    const store = createFileApprovalStore(tmp())
    await store.put(record({ expiresAt: Date.now() - 1 }))
    const registry = createDurableApprovalRegistry(store)
    const listed = (await (
      await handleListDurableApprovals(registry, undefined, 'chat')
    ).json()) as {
      approvals: unknown[]
    }
    expect(listed.approvals).toEqual([])
    let seen: { behavior?: string; message?: string } | undefined
    await approve(registry, { approved: true }, (_r, d) => {
      seen = d
      return new Response('')
    })
    expect(seen?.behavior).toBe('deny')
    expect(seen?.message).toContain("onTimeout: 'abort'")
  })

  it('unknown_approval_schema_version_is_409', async () => {
    const store = createFileApprovalStore(tmp())
    await store.put({ ...record(), schemaVersion: 99 } as unknown as StoredApproval)
    const res = await approve(
      createDurableApprovalRegistry(store),
      { approved: true },
      () => new Response(''),
    )
    expect(res.status).toBe(409)
    expect(await res.text()).toContain('99')
  })

  it('durable_registry_declares_shared_scope', async () => {
    const registry = createDurableApprovalRegistry(createFileApprovalStore(tmp()))
    expect(registry.scope).toBe('shared')
    const body = (await (await handleListDurableApprovals(registry, undefined, 'chat')).json()) as {
      scope: string
    }
    expect(body.scope).toBe('shared')
  })

  it('never_lists_the_owner_and_hides_other_subjects', async () => {
    const store = createFileApprovalStore(tmp())
    await store.put(record({ owner: 'alice' }))
    const registry = createDurableApprovalRegistry(store)
    const mine = await (await handleListDurableApprovals(registry, 'alice', 'chat')).text()
    expect(mine).toContain('a-1')
    expect(mine).not.toContain('alice')
    expect(await (await handleListDurableApprovals(registry, 'bob', 'chat')).text()).not.toContain(
      'a-1',
    )
  })
})
