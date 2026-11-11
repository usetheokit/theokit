import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { DockerSandbox } from '@theokit/agents/sandbox'
import { afterEach, describe, expect, it } from 'vitest'

import { checkHostToolsPosture, resolveToolSettings } from '../src/tools/tool-settings.js'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})
const workspace = (): string => {
  const dir = mkdtempSync(join(process.cwd(), '.sbx-'))
  dirs.push(dir)
  return dir
}
const missing = () => ({ ok: false as const, reason: 'no bwrap' }) as never

describe('THEOCLAW_SANDBOX_BACKEND', () => {
  it('defaults to bwrap', () => {
    const s = resolveToolSettings({}, workspace(), { detect: missing, warn: () => undefined })
    expect(s.sandboxBackend).toBe('bwrap')
    expect(s.sandbox).not.toBeInstanceOf(DockerSandbox)
  })

  it('docker builds a DockerSandbox and passes the host-tools posture without bwrap', () => {
    const env = { THEOCLAW_HOST_TOOLS: 'on', THEOCLAW_SANDBOX_BACKEND: 'docker', THEOCLAW_SANDBOX_IMAGE: 'debian:12' }
    const s = resolveToolSettings(env, workspace(), { detect: missing })
    expect(s.sandboxBackend).toBe('docker')
    expect(s.sandbox).toBeInstanceOf(DockerSandbox)
    expect(() => checkHostToolsPosture(s, [], { detect: missing })).not.toThrow()
  })

  it('refuses an unknown backend and docker outside workspace-write', () => {
    expect(() => resolveToolSettings({ THEOCLAW_SANDBOX_BACKEND: 'podman' }, workspace())).toThrow(/bwrap, docker/)
    expect(() =>
      resolveToolSettings({ THEOCLAW_HOST_TOOLS: 'on', THEOCLAW_SANDBOX_BACKEND: 'docker', THEOCLAW_SANDBOX: 'read-only' }, workspace()),
    ).toThrow(/workspace-write/)
  })
})
