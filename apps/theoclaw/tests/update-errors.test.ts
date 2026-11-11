import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type { Runner } from '../src/run-command.js'
import { update } from '../src/update.js'
import { cleanScratch, commit, git, harness, installedAt, snapshot, world } from './support/update-world.js'

afterEach(cleanScratch)

describe('theoclaw update, settings and git failures', () => {
  it('a git status that fails stops the update before anything moves', async () => {
    const w = world()
    installedAt(w, w.c0)
    commit(w.upstream, 'a', '1\n')
    git(w.upstream, 'push', '-q', 'origin', 'main')
    const before = snapshot(w)
    const h = harness(w)
    const locked: Runner = (command, args) =>
      args.includes('status') ? Promise.resolve({ code: 128, stdout: '', stderr: 'fatal: index.lock exists' }) : h.runner(command, args)

    expect(await update({}, h.io, locked)).toBe(1)
    expect(h.stderr()).toContain('git status failed: fatal: index.lock exists')
    expect(snapshot(w)).toEqual(before)
    expect(h.installs()).toBe(0)
  })

  it('an install outside a git checkout is refused with the npm command', async () => {
    const w = world()
    const h = harness(w)
    const notGit: Runner = (command, args) =>
      args.includes('--show-toplevel') ? Promise.resolve({ code: 128, stdout: '', stderr: 'fatal: not a git repository' }) : h.runner(command, args)

    expect(await update({}, h.io, notGit)).toBe(1)
    expect(h.stderr()).toContain('npm i -g theoclaw@latest')
    expect(h.stderr()).not.toContain('fatal')
    expect(h.installs()).toBe(0)
  })

  it('a channel set only in the configuration file is the one update follows', async () => {
    const w = world()
    installedAt(w, w.c0)
    const dev = commit(w.upstream, 'dev', '1\n')
    git(w.upstream, 'push', '-q', 'origin', 'HEAD:develop')
    const config = join(w.home, 'config')
    mkdirSync(join(config, 'theoclaw'), { recursive: true })
    writeFileSync(join(config, 'theoclaw', 'theoclaw.env'), 'THEOCLAW_UPDATE_CHANNEL="dev"\n')

    const shell = harness(w, { env: { XDG_CONFIG_HOME: config, THEOCLAW_UPDATE_CHANNEL: 'stable' } })
    expect(await update({}, shell.io, shell.runner)).toBe(0)
    expect(snapshot(w).branch).toBe('main')

    const file = harness(w, { env: { XDG_CONFIG_HOME: config } })
    expect(await update({}, file.io, file.runner)).toBe(0)
    expect(snapshot(w)).toMatchObject({ branch: 'develop', head: dev })
  })
})
