import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { type RunResult, runCommand, type Runner, unitPath } from '../../src/daemon.js'
import { type UpdateIo } from '../../src/update.js'

const scratch: string[] = []
export const GIT_ENV = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' }

export function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...GIT_ENV } }).trim()
}

export function commit(cwd: string, file: string, content: string): string {
  writeFileSync(join(cwd, file), content)
  git(cwd, 'add', file)
  git(cwd, 'commit', '-q', '-m', `change ${file}`)
  return git(cwd, 'rev-parse', 'HEAD')
}

export interface World {
  readonly root: string
  readonly home: string
  readonly origin: string
  readonly checkout: string
  /** A second clone that pushes to origin, standing in for upstream. */
  readonly upstream: string
  readonly dist: string
  readonly c0: string
}

export function world(): World {
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

export interface Harness {
  readonly io: UpdateIo
  readonly runner: Runner
  readonly installs: () => number
  readonly restarts: () => string[]
  readonly stdout: () => string
  readonly stderr: () => string
}

export function harness(w: World, options: { env?: NodeJS.ProcessEnv; installExit?: number[]; restartExit?: number[] } = {}): Harness {
  let installs = 0
  const restarts: string[] = []
  const installExit = [...(options.installExit ?? [])]
  const restartExit = [...(options.restartExit ?? [])]
  /** A stubbed step: the next queued exit code (0 when none is queued), and its effect on success. */
  const step = (queue: number[], onSuccess: () => void, what: string): RunResult => {
    const code = queue.shift() ?? 0
    if (code === 0) onSuccess()
    return { code, stdout: '', stderr: code === 0 ? '' : `${what} failed` }
  }
  const runner: Runner = async (command, args) => {
    if (command === 'git') return runCommand(command, args)
    if (command.endsWith('install.sh')) {
      installs += 1
      return step(installExit, () => writeFileSync(join(w.dist, '.installed-commit'), `${git(w.checkout, 'rev-parse', 'HEAD')}\n`), 'install')
    }
    if (command === 'systemctl' && args[1] === 'restart') return step(restartExit, () => restarts.push(args[2]!), 'restart')
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

export function installedAt(w: World, sha: string): void {
  writeFileSync(join(w.dist, '.installed-commit'), `${sha}\n`)
}

export function snapshot(w: World): { branch: string; head: string; status: string } {
  return { branch: git(w.checkout, 'rev-parse', '--abbrev-ref', 'HEAD'), head: git(w.checkout, 'rev-parse', 'HEAD'), status: git(w.checkout, 'status', '--porcelain') }
}

export function installUnit(w: World, label: string): void {
  const path = unitPath(label, w.home)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, '[Unit]\n')
}

/** Removes every scratch directory made since the last call. */
export function cleanScratch(): void {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true })
}
