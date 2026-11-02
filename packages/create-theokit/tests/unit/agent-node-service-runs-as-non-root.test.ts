import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { scaffoldServices } from '../../src/scaffold-services.js'

/** Instruction lines of a Dockerfile: comments and blanks dropped, continuations joined. */
function instructions(dockerfile: string): { keyword: string; args: string }[] {
  const joined = dockerfile.replace(/\\\r?\n/g, ' ')
  return joined
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .map((line) => {
      const [keyword, ...rest] = line.split(/\s+/)
      return { keyword: (keyword ?? '').toUpperCase(), args: rest.join(' ') }
    })
}

describe('agent-node service Dockerfile', () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  it('the generated agent-node Dockerfile switches to a non-root user after its last COPY', () => {
    const target = mkdtempSync(join(tmpdir(), 'agent-node-user-'))
    dirs.push(target)

    scaffoldServices({ targetDir: target, projectName: 'demo', backends: ['node'] })

    const steps = instructions(
      readFileSync(join(target, 'services', 'worker', 'Dockerfile'), 'utf-8'),
    )
    const lastUser = steps
      .map((s, i) => ({ ...s, i }))
      .filter((s) => s.keyword === 'USER')
      .pop()
    const lastCopy = steps
      .map((s, i) => ({ ...s, i }))
      .filter((s) => s.keyword === 'COPY')
      .pop()

    expect(lastUser, 'the Dockerfile declares no USER, so the service runs as root').toBeDefined()
    const user = (lastUser?.args ?? '').split(':')[0]
    expect(['root', '0']).not.toContain(user)
    expect(lastUser?.i ?? -1).toBeGreaterThan(lastCopy?.i ?? Number.MAX_SAFE_INTEGER)
  })
})
