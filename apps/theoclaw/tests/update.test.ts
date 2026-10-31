import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'

import { afterEach, describe, expect, it } from 'vitest'

import { runCommand, type Runner, unitPath } from '../src/daemon.js'
import { channelBranch, update, type UpdateIo } from '../src/update.js'

/**
 * `theoclaw update` (B-374, T4.1) over real git repositories in a scratch directory: a bare origin,
 * the install clone, and a second clone that pushes. Git runs for real; the install step and
 * `systemctl` are stubbed through the runner, and the stubbed install writes the installed-commit
 * marker the way `install.sh` does.
 */
const scratch: string[] = []

afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const GIT_ENV = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' }

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...GIT_ENV } }).trim()
}

function commit(cwd: string, file: string, content: string): string {
  writeFileSync(join(cwd, file), content)
  git(cwd, 'add', file)
  git(cwd, 'commit', '-q', '-m', `change ${file}`)
  return git(cwd, 'rev-parse', 'HEAD')
}

interface World {
  readonly root: string
  readonly home: string
  readonly origin: string
  readonly checkout: string
  /** A second clone that pushes to origin, standing in for upstream. */
  readonly upstream: string
  readonly dist: string
  readonly c0: string
}

function world(): World {
  const root = mkdtempSync(join(tmpdir(), 'theoclaw-update-'))
  scratch.push(root)
  const origin = join(root, 'origin.git')
  const upstream = join(root, 'upstream')
  git(root, 'init', '-q', '--bare', '-b', 'main', origin)
  git(root, 'clone', '-q', origin, upstream)
  mkdirSync(join(upstream, 'apps', 'theoclaw'), { recursive: true })
  writeFileSync(join(upstream, '.gitignore'), 'dist/\n')
  git(upstream, 'add', '.gitignore')
  const c0 = commit(upstream, 'README', 'c0\n')
  git(upstream, 'push', '-q', 'origin', 'main')
  git(upstream, 'push', '-q', 'origin', 'main:develop')
  const checkout = join(root, 'theokit')
  git(root, 'clone', '-q', origin, checkout)
  const dist = join(checkout, 'apps', 'theoclaw', 'dist')
  mkdirSync(dist, { recursive: true })
  writeFileSync(join(dist, 'main.js'), '')
  const home = join(root, 'home')
  mkdirSync(home)
  return { root, home, origin, checkout, upstream, dist, c0 }
}

interface Harness {
  readonly io: UpdateIo
  readonly runner: Runner
  readonly installs: () => number
  readonly restarts: () => string[]
  readonly stdout: () => string
  readonly stderr: () => string
}

function harness(w: World, options: { env?: NodeJS.ProcessEnv; installExit?: number[]; restartExit?: number[] } = {}): Harness {
  let installs = 0
  const restarts: string[] = []
  const installExit = [...(options.installExit ?? [])]
  const restartExit = [...(options.restartExit ?? [])]
  const runner: Runner = async (command, args) => {
    if (command === 'git') return runCommand(command, args)
    if (command.endsWith('install.sh')) {
      installs += 1
      const code = installExit.shift() ?? 0
      if (code === 0) writeFileSync(join(w.dist, '.installed-commit'), `${git(w.checkout, 'rev-parse', 'HEAD')}\n`)
      return { code, stdout: '', stderr: code === 0 ? '' : 'install failed' }
    }
    if (command === 'systemctl' && args[1] === 'restart') {
      const code = restartExit.shift() ?? 0
      if (code === 0) restarts.push(args[2]!)
      return { code, stdout: '', stderr: code === 0 ? '' : 'restart failed' }
    }
    throw new Error(`unexpected command ${command} ${args.join(' ')}`)
  }
  let out = ''
  let err = ''
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  stdout.on('data', (chunk: Buffer) => (out += chunk.toString()))
  stderr.on('data', (chunk: Buffer) => (err += chunk.toString()))
  const io: UpdateIo = {
    env: { ...options.env },
    homeDir: w.home,
    cwd: w.root,
    platform: 'linux',
    nodePath: process.execPath,
    entry: join(w.dist, 'main.js'),
    stdout,
    stderr,
  }
  return { io, runner, installs: () => installs, restarts: () => restarts, stdout: () => out, stderr: () => err }
}

function installedAt(w: World, sha: string): void {
  writeFileSync(join(w.dist, '.installed-commit'), `${sha}\n`)
}

function snapshot(w: World): { branch: string; head: string; status: string } {
  return { branch: git(w.checkout, 'rev-parse', '--abbrev-ref', 'HEAD'), head: git(w.checkout, 'rev-parse', 'HEAD'), status: git(w.checkout, 'status', '--porcelain') }
}

function installUnit(w: World, label: string): void {
  const path = unitPath(label, w.home)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, '[Unit]\n')
}

describe('theoclaw update', () => {
  it('update fast-forwards a clean checkout and refuses a dirty one unchanged', async () => {
    const w = world()
    installedAt(w, w.c0)
    commit(w.upstream, 'a', '1\n')
    const c2 = commit(w.upstream, 'b', '2\n')
    git(w.upstream, 'push', '-q', 'origin', 'main')
    const h = harness(w)

    expect(await update({}, h.io, h.runner)).toBe(0)
    expect(git(w.checkout, 'rev-parse', 'HEAD')).toBe(c2)
    expect(h.stdout()).toMatch(new RegExp(`^updated ${w.c0} -> ${c2}`, 'm'))

    writeFileSync(join(w.checkout, 'README'), 'edited\n')
    const before = snapshot(w)
    const dirty = harness(w)
    expect(await update({}, dirty.io, dirty.runner)).toBe(1)
    expect(dirty.stderr()).toContain('the checkout has local changes')
    expect(snapshot(w)).toEqual(before)
    expect(dirty.installs()).toBe(0)
  })

  it('an up-to-date checkout prints already up to date', async () => {
    const w = world()
    installedAt(w, w.c0)
    const h = harness(w)
    expect(await update({}, h.io, h.runner)).toBe(0)
    expect(h.stdout()).toMatch(/^theoclaw update: already up to date/m)
    expect(h.installs()).toBe(0)
  })

  it('a refused channel switch leaves the checkout where it was', async () => {
    const w = world()
    installedAt(w, w.c0)
    git(w.checkout, 'branch', 'develop', 'origin/develop')
    git(w.checkout, 'switch', '-q', 'develop')
    commit(w.checkout, 'local', 'mine\n')
    git(w.checkout, 'switch', '-q', 'main')
    commit(w.upstream, 'up', 'theirs\n')
    git(w.upstream, 'push', '-q', 'origin', 'HEAD:develop')
    const before = snapshot(w)
    const h = harness(w)

    expect(await update({ channel: 'dev' }, h.io, h.runner)).toBe(1)
    expect(h.stderr()).toContain('develop')
    expect(snapshot(w)).toEqual(before)
  })

  it('a checkout with a local commit on its own branch is refused unchanged', async () => {
    const w = world()
    installedAt(w, w.c0)
    commit(w.checkout, 'local', 'mine\n')
    commit(w.upstream, 'up', 'theirs\n')
    git(w.upstream, 'push', '-q', 'origin', 'main')
    const before = snapshot(w)
    const h = harness(w)

    expect(await update({}, h.io, h.runner)).toBe(1)
    expect(h.stderr()).toMatch(/main .*diverged/)
    expect(snapshot(w)).toEqual(before)
  })

  it('a fetch that fails stops the update with git\'s message', async () => {
    const w = world()
    installedAt(w, w.c0)
    git(w.checkout, 'remote', 'set-url', 'origin', join(w.root, 'missing.git'))
    const h = harness(w)
    expect(await update({}, h.io, h.runner)).toBe(1)
    expect(h.stderr()).toMatch(/fetch .*missing\.git/s)
    expect(h.installs()).toBe(0)
  })

  it("each profile's unit is restarted by its own update", async () => {
    const w = world()
    installedAt(w, w.c0)
    for (const label of ['theoclaw-a', 'theoclaw-b']) {
      installUnit(w, label)
      writeFileSync(join(w.dist, `.restarted-commit-${label}`), `${w.c0}\n`)
    }
    const c1 = commit(w.upstream, 'next', '1\n')
    git(w.upstream, 'push', '-q', 'origin', 'main')

    const a = harness(w, { env: { THEOCLAW_PROFILE: 'a' } })
    expect(await update({}, a.io, a.runner)).toBe(0)
    expect(a.restarts()).toEqual(['theoclaw-a.service'])

    const b = harness(w, { env: { THEOCLAW_PROFILE: 'b' } })
    expect(await update({}, b.io, b.runner)).toBe(0)
    expect(b.stdout()).toMatch(new RegExp(`^updated ${w.c0} -> ${c1}`, 'm'))
    expect(b.stdout()).not.toContain('already up to date')
    expect(b.restarts()).toEqual(['theoclaw-b.service'])
    expect(readFileSync(join(w.dist, '.restarted-commit-theoclaw-b'), 'utf8').trim()).toBe(c1)
  })

  it('a retry after a failed restart restarts', async () => {
    const w = world()
    installedAt(w, w.c0)
    installUnit(w, 'theoclaw')
    const c1 = commit(w.upstream, 'next', '1\n')
    git(w.upstream, 'push', '-q', 'origin', 'main')

    const first = harness(w, { restartExit: [1] })
    expect(await update({}, first.io, first.runner)).toBe(1)
    expect(first.stderr()).toContain('restart')
    expect(readFileSync(join(w.dist, '.installed-commit'), 'utf8').trim()).toBe(c1)

    const second = harness(w)
    expect(await update({}, second.io, second.runner)).toBe(0)
    expect(second.restarts()).toEqual(['theoclaw.service'])
    expect(readFileSync(join(w.dist, '.restarted-commit-theoclaw'), 'utf8').trim()).toBe(c1)
  })

  it('a retry after a failed install completes it', async () => {
    const w = world()
    installedAt(w, w.c0)
    installUnit(w, 'theoclaw')
    const c1 = commit(w.upstream, 'next', '1\n')
    git(w.upstream, 'push', '-q', 'origin', 'main')
    let installCalls = 0

    const first = harness(w, { installExit: [1] })
    expect(await update({}, first.io, first.runner)).toBe(1)
    installCalls += first.installs()
    expect(first.restarts()).toEqual([])
    expect(git(w.checkout, 'rev-parse', 'HEAD')).toBe(c1)

    const second = harness(w)
    expect(await update({}, second.io, second.runner)).toBe(0)
    installCalls += second.installs()
    expect(installCalls).toBe(2)
    expect(second.restarts()).toEqual(['theoclaw.service'])
    expect(second.stdout()).toMatch(new RegExp(`^updated ${w.c0} -> ${c1}`, 'm'))
  })

  it('an unknown channel is refused naming stable and dev', async () => {
    expect(channelBranch('stable')).toBe('main')
    expect(channelBranch('dev')).toBe('develop')
    expect(() => channelBranch('nightly')).toThrow(/stable.*dev/)
    const w = world()
    const h = harness(w, { env: { THEOCLAW_UPDATE_CHANNEL: 'beta' } })
    await expect(update({}, h.io, h.runner)).rejects.toThrow(/stable.*dev/)
  })

  it('update creates the channel branch from origin', async () => {
    const w = world()
    installedAt(w, w.c0)
    git(w.upstream, 'switch', '-q', '-c', 'develop', '--track', 'origin/develop')
    const ahead = commit(w.upstream, 'dev', '1\n')
    git(w.upstream, 'push', '-q', 'origin', 'develop')
    expect(existsSync(join(w.checkout, '.git', 'refs', 'heads', 'develop'))).toBe(false)
    const h = harness(w)

    expect(await update({ channel: 'dev' }, h.io, h.runner)).toBe(0)
    const currentBranch = git(w.checkout, 'rev-parse', '--abbrev-ref', 'HEAD')
    expect(currentBranch).toBe('develop')
    expect(git(w.checkout, 'rev-parse', 'HEAD')).toBe(ahead)
    expect(git(w.checkout, 'rev-parse', 'HEAD')).toBe(git(w.checkout, 'rev-parse', 'origin/develop'))
  })
})
