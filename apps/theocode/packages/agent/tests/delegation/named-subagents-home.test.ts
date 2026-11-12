// #1904 — `namedSubagentDefinitions` hands the configured home to `discoverRoles`.
import { describe, expect, it, vi } from 'vitest'

const discoverRoles = vi.fn(async () => ({}))
vi.mock('../../src/delegation/role-discovery.js', () => ({
  discoverRoles: (...a: unknown[]) => (discoverRoles as (...x: unknown[]) => unknown)(...a),
}))

import { diskEntities } from '../../src/chat/disk-entities.js'
import { namedSubagentDefinitions } from '../../src/delegation/named-subagents.js'

describe('namedSubagentDefinitions', () => {
  it('passes the configured home to discoverRoles', async () => {
    await namedSubagentDefinitions('/repo', false, '/configured/home')
    expect(discoverRoles).toHaveBeenCalledWith({
      cwd: '/repo',
      home: '/configured/home',
      projectAllowed: false,
    })
  })

  it('diskEntities forwards the operator home to discoverRoles', async () => {
    discoverRoles.mockClear()
    await diskEntities('/repo', '/operator/home', { allows: { subagents: true } } as never)
    expect(discoverRoles).toHaveBeenCalledWith({
      cwd: '/repo',
      home: '/operator/home',
      projectAllowed: true,
    })
  })
})
