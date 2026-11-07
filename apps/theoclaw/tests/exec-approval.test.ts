import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { createExecApproval, createExecApprovalStore } from '../src/tools/exec-approval.js'

const dir = (): string => mkdtempSync(join(tmpdir(), 'exec-approval-'))

describe('exec approval', () => {
  it('runs a saved command after a restart without a prompt, and still asks about another', async () => {
    const state = dir()
    const first = createExecApproval({ store: createExecApprovalStore(state), ask: async () => 'always' })
    expect((await first('ls -la')).allowed).toBe(true)

    const ask = vi.fn(async () => 'deny' as const)
    const second = createExecApproval({ store: createExecApprovalStore(state), ask })
    expect((await second('ls -la')).allowed).toBe(true)
    expect(ask).not.toHaveBeenCalled()
    expect((await second('ls -la /')).allowed).toBe(false)
    expect(ask).toHaveBeenCalledTimes(1)
  })

  it('refuses on a reviewer deny before any prompt', async () => {
    const ask = vi.fn(async () => 'once' as const)
    const decide = createExecApproval({ store: createExecApprovalStore(dir()), reviewer: async () => 'deny', ask })
    expect((await decide('rm -rf /')).allowed).toBe(false)
    expect(ask).not.toHaveBeenCalled()
  })

  it('asks the person when the reviewer fails', async () => {
    const ask = vi.fn(async () => 'once' as const)
    const decide = createExecApproval({
      store: createExecApprovalStore(dir()),
      reviewer: async () => {
        throw new Error('model down')
      },
      ask,
    })
    expect((await decide('make')).allowed).toBe(true)
    expect(ask).toHaveBeenCalledTimes(1)
  })

  it('does not remember a once answer', async () => {
    const state = dir()
    const decide = createExecApproval({ store: createExecApprovalStore(state), ask: async () => 'once' })
    await decide('make')
    expect(createExecApprovalStore(state).has('make')).toBe(false)
  })
})
