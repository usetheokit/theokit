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

  it('keeps the pnpm preparation fatal and the runtime owner wired to the non-root user', () => {
    const target = mkdtempSync(join(tmpdir(), 'agent-node-corepack-'))
    dirs.push(target)

    scaffoldServices({ targetDir: target, projectName: 'demo', backends: ['node'] })

    const steps = instructions(
      readFileSync(join(target, 'services', 'worker', 'Dockerfile'), 'utf-8'),
    )
    const prepare = steps.find((s) => s.keyword === 'RUN' && s.args.includes('corepack prepare'))
    expect(prepare, 'no corepack prepare step').toBeDefined()
    expect(prepare?.args, 'a failed prepare must fail the build').not.toContain('|| true')
    expect(prepare?.args, 'pnpm must be pinned, not latest').not.toContain('pnpm@latest')
    expect(steps.some((s) => s.keyword === 'ENV' && s.args.startsWith('COREPACK_HOME='))).toBe(true)
    for (const copy of steps.filter((s) => s.keyword === 'COPY')) {
      expect(copy.args).toContain('--chown=1000:1000')
    }
  })

  it('installs dependencies with one pnpm command that cannot fall back to npm or demand an absent lockfile', () => {
    const target = mkdtempSync(join(tmpdir(), 'agent-node-install-'))
    dirs.push(target)

    scaffoldServices({ targetDir: target, projectName: 'demo', backends: ['node'] })

    const steps = instructions(
      readFileSync(join(target, 'services', 'worker', 'Dockerfile'), 'utf-8'),
    )
    const install = steps.find((s) => s.keyword === 'RUN' && s.args.includes('pnpm install'))
    expect(install, 'no pnpm install step').toBeDefined()
    expect(install?.args, 'a failed pnpm install must fail the build, not fall back').not.toContain(
      '||',
    )
    expect(install?.args).not.toMatch(/(^|\s)npm\s+install/)
    const shipsLockfile = steps.some(
      (s) => s.keyword === 'COPY' && s.args.includes('pnpm-lock.yaml'),
    )
    if (!shipsLockfile) {
      expect(
        install?.args,
        'no lockfile is copied, so --frozen-lockfile can never succeed',
      ).not.toContain('--frozen-lockfile')
    }
  })
})
