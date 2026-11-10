/**
 * B-400 Phase 3 (FR-008 to FR-010, NFR-002, NFR-003): the instance lock, `theoclaw backup` and
 * `theoclaw restore`. Child processes are real processes, so a pid is a real holder.
 */
import { type ChildProcess, spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

import {
  backupInstance,
  BackupRefusal,
  type Manifest,
  restoreInstance,
} from '../src/backup/backup.js'
import {
  claimInstance,
  InstanceLockedError,
  instanceLockPath,
  takeInstanceLock,
} from '../src/backup/instance-lock.js'
import { NO_PROFILE } from '../src/instance.js'
import { waitFor } from './fakes.js'

const APP_DIR = fileURLToPath(new URL('..', import.meta.url))
const TSX_LOADER = import.meta.resolve('tsx')
const LOCK_MODULE = join(APP_DIR, 'src', 'backup', 'instance-lock.ts')

const scratch: string[] = []
const children: ChildProcess[] = []

afterEach(() => {
  for (const child of children.splice(0)) if (child.exitCode === null) child.kill('SIGKILL')
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'theoclaw-backup-'))
  scratch.push(dir)
  return dir
}

/** A pid no process has any more: a child that already exited. */
async function deadPid(): Promise<number> {
  const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' })
  const pid = child.pid!
  await new Promise((resolve) => child.once('exit', resolve))
  return pid
}

/** A lock left by a process that is gone, as a crash leaves it. */
async function staleLock(stateDir: string): Promise<string> {
  const nonce = randomBytes(16).toString('hex')
  writeFileSync(instanceLockPath(stateDir), `${await deadPid()}\n${nonce}\n`, { mode: 0o600 })
  return nonce
}

interface LockChild {
  readonly pid: number
  /** `took` or `refused <message>`, once the child answered. */
  readonly answer: Promise<string>
  /** Let the child release and exit. */
  end(): Promise<void>
}

/** A child process that takes the instance lock and holds it until `end()`. */
function lockChild(stateDir: string, startGate?: string): LockChild {
  const script = join(tempDir(), 'take.ts')
  writeFileSync(
    script,
    [
      `import { existsSync } from "node:fs";`,
      `import { takeInstanceLock } from ${JSON.stringify(LOCK_MODULE)};`,
      `const gate = process.argv[3];`,
      `while (gate !== undefined && !existsSync(gate)) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2);`,
      `let release = () => {};`,
      `try { release = takeInstanceLock(process.argv[2]).release; process.stdout.write("took\\n"); }`,
      `catch (error) { process.stdout.write("refused " + error.message + "\\n"); }`,
      `process.stdin.on("end", () => { release(); process.exit(0); });`,
      `process.stdin.resume();`,
    ].join('\n'),
  )
  const child = spawn(
    process.execPath,
    ['--import', TSX_LOADER, script, stateDir, ...(startGate === undefined ? [] : [startGate])],
    {
      stdio: ['pipe', 'pipe', 'inherit'],
    },
  )
  children.push(child)
  let output = ''
  child.stdout!.on('data', (chunk: Buffer) => (output += chunk.toString()))
  const answer = waitFor(() => output.includes('\n'), 30_000, "the child's answer").then(() =>
    output.trim(),
  )
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
  return { pid: child.pid!, answer, end: () => (child.stdin!.end(), exited) }
}

interface RaceChild {
  readonly pid: number
  /** The line the child printed for `round`: `took` or `refused <message>`, once it answered. */
  answer(round: number): Promise<string>
  /** Resolves once the child is waiting at the gate of `round`. */
  ready(round: number): Promise<void>
  end(): Promise<void>
}

/**
 * A real child process that races for the lock once per round and is reused across rounds, so the
 * tsx start-up is paid once per child and not once per round. Each round has its own state directory
 * and gate under `root`; the child prints `ready`, waits for the gate, takes the lock, prints the
 * answer and holds the lock until the round's `done` file exists.
 */
function raceChild(root: string, rounds: number): RaceChild {
  const script = join(tempDir(), 'race.ts')
  writeFileSync(
    script,
    [
      `import { existsSync } from "node:fs";`,
      `import { join } from "node:path";`,
      `import { takeInstanceLock } from ${JSON.stringify(LOCK_MODULE)};`,
      `const pause = () => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2);`,
      `for (let round = 0; round < Number(process.argv[3]); round += 1) {`,
      `  const dir = join(process.argv[2], "round-" + round);`,
      `  process.stdout.write("ready\\n");`,
      `  while (!existsSync(join(dir, "go"))) pause();`,
      `  let release = () => {};`,
      `  try { release = takeInstanceLock(join(dir, "state")).release; process.stdout.write("took\\n"); }`,
      `  catch (error) { process.stdout.write("refused " + error.message + "\\n"); }`,
      `  while (!existsSync(join(dir, "done"))) pause();`,
      `  release();`,
      `}`,
    ].join('\n'),
  )
  const child = spawn(process.execPath, ['--import', TSX_LOADER, script, root, String(rounds)], {
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  children.push(child)
  let output = ''
  child.stdout!.on('data', (chunk: Buffer) => (output += chunk.toString()))
  const lines = () => output.split('\n').filter((line) => line !== '')
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
  return {
    pid: child.pid!,
    ready: (round) =>
      waitFor(() => lines().length >= 2 * round + 1, 30_000, 'the child at its gate'),
    answer: async (round) => {
      await waitFor(() => lines().length >= 2 * round + 2, 30_000, "the child's answer")
      return lines()[2 * round + 1]!
    },
    end: () => exited,
  }
}

/** Run `rounds` races between two reused children; `prepare` sets a round's state directory up first. */
async function race(
  rounds: number,
  prepare: (stateDir: string) => Promise<void>,
  check: (stateDir: string, answers: string[], racers: RaceChild[]) => void,
): Promise<void> {
  const root = tempDir()
  const racers = [raceChild(root, rounds), raceChild(root, rounds)]
  for (let round = 0; round < rounds; round += 1) {
    const dir = join(root, `round-${round}`)
    mkdirSync(dir, { recursive: true })
    await prepare(join(dir, 'state'))
    await Promise.all(racers.map((racer) => racer.ready(round)))
    writeFileSync(join(dir, 'go'), '')
    const answers = await Promise.all(racers.map((racer) => racer.answer(round)))
    check(join(dir, 'state'), answers, racers)
    writeFileSync(join(dir, 'done'), '')
  }
  await Promise.all(racers.map((racer) => racer.end()))
}

describe('the instance lock (FR-010)', () => {
  it('a second take of a held lock is refused naming the pid', () => {
    const stateDir = join(tempDir(), 'state')
    const lock = takeInstanceLock(stateDir)
    expect(() => takeInstanceLock(stateDir)).toThrow(InstanceLockedError)
    expect(() => takeInstanceLock(stateDir)).toThrow(`is held by process ${process.pid}`)
    lock.release()
    takeInstanceLock(stateDir).release()
  })

  it('lives beside the state directory, written 0600, and copies into no backup of it', () => {
    const root = tempDir()
    const lock = takeInstanceLock(join(root, 'state'))
    expect(lock.path).toBe(join(root, 'state.instance.lock'))
    expect(readFileSync(lock.path, 'utf8')).toMatch(/^\d+\n[0-9a-f]{32}\n$/)
    expect(existsSync(join(root, 'state'))).toBe(false)
    lock.release()
    expect(readdirSync(root)).toEqual([])
  })

  it('a lock whose process is gone is taken over', async () => {
    const stateDir = join(tempDir(), 'state')
    takeInstanceLock(stateDir).release()
    const stale = await staleLock(stateDir)
    const lock = takeInstanceLock(stateDir)
    expect(lock.nonce).not.toBe(stale)
    expect(readFileSync(lock.path, 'utf8')).toBe(`${process.pid}\n${lock.nonce}\n`)
    lock.release()
  })

  it('a start is refused naming the pid while a backup holds the lock', async () => {
    const root = tempDir()
    const stateDir = join(root, 'state')
    const holder = lockChild(stateDir)
    expect(await holder.answer).toBe('took')
    const env: NodeJS.ProcessEnv = { THEOCLAW_STATE_DIR: stateDir }
    expect(() => claimInstance(NO_PROFILE, env)).toThrow(`is held by process ${holder.pid}`)
    await holder.end()
    claimInstance(NO_PROFILE, env)?.()
  })

  it("a start refused by a restore's lock leaves an absent state target absent", () => {
    const home = tempDir()
    const directory = join(home, 'profile')
    const stateDirectory = join(directory, 'state')
    const instance = {
      label: 'theoclaw-p',
      profile: 'p',
      directory,
      workspace: join(directory, 'workspace'),
      stateDirectory,
      overrides: {
        THEOCLAW_STATE_DIR: stateDirectory,
        THEOCLAW_WORKSPACE: join(directory, 'workspace'),
      },
    }
    let restore: { release(): void } | undefined
    // The start is paused before its lock; a restore takes the lock in that window.
    const start = () =>
      claimInstance(
        instance,
        {},
        { beforeLock: () => (restore = takeInstanceLock(stateDirectory)) },
      )
    expect(start).toThrow(InstanceLockedError)
    expect(existsSync(stateDirectory)).toBe(false)
    expect(existsSync(instance.workspace)).toBe(false)
    restore?.release()
  })

  it('a start with no state directory takes no lock', () => {
    expect(claimInstance(NO_PROFILE, {})).toBeUndefined()
    expect(claimInstance(NO_PROFILE, { THEOCLAW_STATE_DIR: '  ' })).toBeUndefined()
  })

  it("a delayed taker of a lock generation already taken over refuses and leaves the new holder's lock in place", async () => {
    const stateDir = join(tempDir(), 'state')
    await staleLock(stateDir)
    let holders = 0
    let taken: { nonce: string; release(): void } | undefined
    // B reads the stale generation and is paused; A takes over, C is refused against A's live lock.
    const takerB = () =>
      takeInstanceLock(stateDir, {
        beforeTakeover: () => {
          if (taken !== undefined) return
          taken = takeInstanceLock(stateDir)
          holders += 1
          expect(() => takeInstanceLock(stateDir)).toThrow(InstanceLockedError)
        },
      })
    expect(takerB).toThrow(`is held by process ${process.pid}`)
    expect(holders).toBe(1)
    expect(readFileSync(instanceLockPath(stateDir), 'utf8')).toBe(
      `${process.pid}\n${taken!.nonce}\n`,
    )
    taken!.release()
  })

  it('a takeover file left for a dead generation does not block taking over a later stale lock', async () => {
    const stateDir = join(tempDir(), 'state')
    const gone = await staleLock(stateDir)
    // A taker of generation `gone` crashed holding its takeover file; a later generation is stale too.
    writeFileSync(`${instanceLockPath(stateDir)}.takeover-${gone}`, '1\n')
    await staleLock(stateDir)
    const lock = takeInstanceLock(stateDir)
    lock.release()
    expect(readdirSync(join(stateDir, '..'))).toEqual([])
  })

  it('a takeover that never finished on the current generation is refused naming both files', async () => {
    const stateDir = join(tempDir(), 'state')
    const nonce = await staleLock(stateDir)
    writeFileSync(`${instanceLockPath(stateDir)}.takeover-${nonce}`, '1\n')
    expect(() => takeInstanceLock(stateDir)).toThrow(
      /takeover-[0-9a-f]{32} says a takeover of it never finished; .*delete both files/,
    )
  })

  it('a release removes the claim file a process that is gone left behind', async () => {
    const stateDir = join(tempDir(), 'state')
    const left = `${instanceLockPath(stateDir)}.claim-${await deadPid()}-${randomBytes(16).toString('hex')}`
    takeInstanceLock(stateDir).release()
    writeFileSync(left, 'x')
    takeInstanceLock(stateDir).release()
    expect(existsSync(left)).toBe(false)
  })

  it('two processes racing for the lock: exactly one takes it, 20 times (concurrent test)', async () => {
    await race(
      20,
      async () => {},
      (_state, answers) => {
        // Atomic-counter invariant: one holder, never two and never none.
        expect(answers.filter((answer) => answer === 'took')).toHaveLength(1)
      },
    )
  }, 120_000)

  it('two processes taking over one stale lock: exactly one holds it and the lock names it, 20 times (concurrent test)', async () => {
    await race(
      20,
      async (stateDir) => void (await staleLock(stateDir)),
      (stateDir, answers, racers) => {
        const winners = racers.filter((_, index) => answers[index] === 'took')
        expect(winners).toHaveLength(1)
        expect(readFileSync(instanceLockPath(stateDir), 'utf8').split('\n')[0]).toBe(
          String(winners[0]!.pid),
        )
      },
    )
  }, 180_000)
})

const SECRET = 'sk-backup-configured-secret-0123456789'
const IMPORTED_SECRET = 'mcp-imported-env-value-9876543210'

interface Instance {
  readonly root: string
  readonly env: NodeJS.ProcessEnv
  readonly state: string
  readonly workspace: string
}

/** An instance with no configuration file: its state directory and workspace named by the environment. */
function instance(root = tempDir()): Instance {
  const state = join(root, 'state')
  const workspace = join(root, 'workspace')
  const env = {
    THEOCLAW_STATE_DIR: state,
    THEOCLAW_WORKSPACE: workspace,
    THEOKIT_API_KEY: SECRET,
    XDG_CONFIG_HOME: join(root, 'config'),
  }
  return { root, env, state, workspace }
}

/** A stopped instance with three sessions, a pairing file and a migration import carrying an MCP env value. */
function populated(sessions = 3): Instance {
  const source = instance()
  mkdirSync(join(source.workspace, '.theoclaw', 'sessions'), { recursive: true })
  for (let n = 0; n < sessions; n += 1) {
    writeFileSync(
      join(source.workspace, '.theoclaw', 'sessions', `session-${n}.jsonl`),
      `{"turn":"code word ${n}"}\n`,
    )
  }
  writeFileSync(join(source.workspace, '.theoclaw', 'sessions.json'), '{"generations":{}}\n')
  mkdirSync(join(source.state, 'import'), { recursive: true })
  writeFileSync(
    join(source.state, 'import', '.mcp.json'),
    JSON.stringify({ servers: { x: { env: { TOKEN: IMPORTED_SECRET } } } }),
  )
  mkdirSync(join(source.state, 'import.staging-12'), { recursive: true })
  writeFileSync(join(source.state, 'pairing.json'), '{"paired":[]}\n')
  return source
}

const HOME = (target: Instance) => ({ homeDir: target.root })

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
}

describe('theoclaw backup (FR-008)', () => {
  it('backup files are written 0600 and directories 0700', () => {
    const source = populated()
    const dir = join(tempDir(), 'backup')
    backupInstance(source.env, dir, HOME(source))
    for (const file of filesUnder(dir)) expect(statSync(file).mode & 0o777).toBe(0o600)
    for (const sub of [
      dir,
      join(dir, 'state'),
      join(dir, 'workspace'),
      join(dir, 'workspace', '.theoclaw'),
    ]) {
      expect(statSync(sub).mode & 0o777).toBe(0o700)
    }
  })

  it('backup refuses a target directory that is not empty', () => {
    const source = populated()
    const dir = tempDir()
    writeFileSync(join(dir, 'keep.txt'), 'mine')
    expect(() => backupInstance(source.env, dir, HOME(source))).toThrow(/is not empty/)
    expect(readdirSync(dir)).toEqual(['keep.txt'])
  })

  it('a backup leaves out the migration import, and no byte it writes contains a configured or imported secret', () => {
    const source = populated()
    const dir = join(tempDir(), 'backup')
    const manifest = backupInstance(source.env, dir, HOME(source))
    expect(
      manifest.files.map((entry) => entry.path).filter((path) => path.startsWith('state/')),
    ).toEqual(['state/pairing.json'])
    for (const file of filesUnder(dir)) {
      const bytes = readFileSync(file, 'utf8')
      expect(bytes).not.toContain(SECRET)
      expect(bytes).not.toContain(IMPORTED_SECRET)
    }
  })

  it('backup refuses naming THEOCLAW_STATE_DIR when it is unset', () => {
    const source = populated()
    const env = { ...source.env, THEOCLAW_STATE_DIR: undefined }
    expect(() => backupInstance(env, join(tempDir(), 'b'), HOME(source))).toThrow(
      /THEOCLAW_STATE_DIR is unset/,
    )
  })

  it('backup refuses a directory inside the workspace it copies (EC-2)', () => {
    const source = populated()
    const dir = join(source.workspace, 'backups', 'today')
    expect(() => backupInstance(source.env, dir, HOME(source))).toThrow(
      new RegExp(`${dir}.*inside ${source.workspace}`),
    )
    expect(existsSync(join(source.workspace, 'backups'))).toBe(false)
  })

  it('backup refuses a symbolic link in a source, naming it', async () => {
    const source = populated()
    const { symlinkSync } = await import('node:fs')
    symlinkSync('/etc/hostname', join(source.workspace, 'link'))
    const dir = join(tempDir(), 'backup')
    expect(() => backupInstance(source.env, dir, HOME(source))).toThrow(/link is a symbolic link/)
    expect(existsSync(dir)).toBe(false)
  })

  it('backup refuses while instance.lock names a live process', async () => {
    const source = populated()
    const holder = lockChild(source.state)
    expect(await holder.answer).toBe('took')
    const dir = join(tempDir(), 'backup')
    expect(() => backupInstance(source.env, dir, HOME(source))).toThrow(
      `is held by process ${holder.pid}`,
    )
    expect(existsSync(dir)).toBe(false)
    await holder.end()
  })
})

describe('theoclaw restore (FR-009)', () => {
  function backedUp(): { source: Instance; dir: string; manifest: Manifest } {
    const source = populated()
    const dir = join(tempDir(), 'backup')
    return { source, dir, manifest: backupInstance(source.env, dir, HOME(source)) }
  }

  it('a backup restored into an empty profile reproduces every file byte for byte', () => {
    const { source, dir, manifest } = backedUp()
    const target = instance()
    const started = Date.now()
    restoreInstance(target.env, dir, HOME(target))
    // NFR-003: a 3-session restore well under 10 s, modes 0700 and 0600.
    expect(Date.now() - started).toBeLessThan(10_000)
    for (const entry of manifest.files) {
      const [root, ...rest] = entry.path.split('/')
      const from = join(root === 'state' ? source.state : source.workspace, ...rest)
      const to = join(root === 'state' ? target.state : target.workspace, ...rest)
      expect(readFileSync(to)).toEqual(readFileSync(from))
      expect(statSync(to).mode & 0o777).toBe(0o600)
    }
    expect(statSync(target.state).mode & 0o777).toBe(0o700)
    expect(statSync(target.workspace).mode & 0o777).toBe(0o700)
    expect(existsSync(join(target.state, 'import'))).toBe(false)
  })

  it('restore refuses a non-empty workspace and writes nothing', () => {
    const { dir } = backedUp()
    const target = instance()
    mkdirSync(target.workspace, { recursive: true })
    writeFileSync(join(target.workspace, 'mine.txt'), 'keep')
    expect(() => restoreInstance(target.env, dir, HOME(target))).toThrow(
      new RegExp(`${target.workspace} is not empty`),
    )
    expect(readdirSync(target.workspace)).toEqual(['mine.txt'])
    expect(existsSync(target.state)).toBe(false)
  })

  it('restore refuses a file whose sha256 differs, naming its path', () => {
    const { dir } = backedUp()
    const tampered = join(dir, 'workspace', '.theoclaw', 'sessions', 'session-1.jsonl')
    const bytes = readFileSync(tampered)
    bytes[0] = bytes[0]! ^ 1
    writeFileSync(tampered, bytes)
    const target = instance()
    expect(() => restoreInstance(target.env, dir, HOME(target))).toThrow(
      /workspace\/\.theoclaw\/sessions\/session-1\.jsonl does not match its sha256/,
    )
    expect(existsSync(target.state)).toBe(false)
    expect(existsSync(target.workspace)).toBe(false)
  })

  it('restore refuses a manifest entry that leaves its root, and writes nothing (EC-3)', () => {
    const { dir } = backedUp()
    const target = instance()
    for (const path of ['../../.bashrc', 'state/../../outside', '/etc/passwd', 'other/file']) {
      const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as Manifest
      writeFileSync(
        join(dir, 'manifest.json'),
        JSON.stringify({
          ...manifest,
          files: [...manifest.files, { path, sha256: '0'.repeat(64), size: 0 }],
        }),
      )
      expect(() => restoreInstance(target.env, dir, HOME(target))).toThrow(BackupRefusal)
      expect(() => restoreInstance(target.env, dir, HOME(target))).toThrow(
        /leaves state\/ and workspace\//,
      )
      writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest))
    }
    expect(existsSync(target.state)).toBe(false)
    expect(existsSync(join(target.root, 'outside'))).toBe(false)
  })

  it('a restore that fails midway leaves the target unchanged and a retry succeeds (EC-1)', () => {
    const { dir, manifest } = backedUp()
    const target = instance()
    let copied = 0
    const failing = {
      ...HOME(target),
      onFileCopied: () => {
        copied += 1
        if (copied === 2) throw new Error('disk full')
      },
    }
    expect(() => restoreInstance(target.env, dir, failing)).toThrow('disk full')
    expect(existsSync(target.state)).toBe(false)
    expect(existsSync(target.workspace)).toBe(false)
    expect(readdirSync(target.root).filter((name) => name.includes('.restore-'))).toEqual([])
    restoreInstance(target.env, dir, HOME(target))
    expect(filesUnder(target.state).length + filesUnder(target.workspace).length).toBe(
      manifest.files.length,
    )
  })

  it('a restore whose workspace rename fails puts the state target back and changes neither (EC-1)', () => {
    const { dir } = backedUp()
    const target = instance()
    const rename = (from: string, to: string) => {
      if (to === target.workspace) throw new Error('rename refused')
      renameSync(from, to)
    }
    expect(() => restoreInstance(target.env, dir, { ...HOME(target), rename })).toThrow(
      'rename refused',
    )
    expect(existsSync(target.state)).toBe(false)
    expect(existsSync(target.workspace)).toBe(false)
    expect(readdirSync(target.root).filter((name) => name.includes('.restore-'))).toEqual([])
  })

  it('a failed workspace rename leaves a state target that existed empty still present, empty, with its mode', () => {
    const { dir } = backedUp()
    const target = instance()
    mkdirSync(target.state, { recursive: true })
    chmodSync(target.state, 0o750)
    const rename = (from: string, to: string) => {
      if (to === target.workspace) throw new Error('rename refused')
      renameSync(from, to)
    }
    expect(() => restoreInstance(target.env, dir, { ...HOME(target), rename })).toThrow(
      'rename refused',
    )
    expect(readdirSync(target.state)).toEqual([])
    expect(statSync(target.state).mode & 0o777).toBe(0o750)
  })

  it('restore into an absent profile while holding the instance lock places both targets', () => {
    const { dir } = backedUp()
    const home = tempDir()
    const target = {
      root: home,
      env: { THEOCLAW_PROFILE: 'restored', XDG_CONFIG_HOME: join(home, 'config') },
    }
    restoreInstance(target.env, dir, { homeDir: home })
    const profile = join(home, '.theokit', 'profiles', 'restored')
    expect(readdirSync(join(profile, 'workspace', '.theoclaw', 'sessions'))).toHaveLength(3)
    expect(readFileSync(join(profile, 'state', 'pairing.json'), 'utf8')).toContain('paired')
    expect(existsSync(instanceLockPath(join(profile, 'state')))).toBe(false)
  })

  it("restore re-homes the session transcripts under the new workspace's own name", async () => {
    const { encodeProjectDir } = await import('@theokit/sdk/persistence')
    const source = populated()
    const projects = join(
      source.workspace,
      '.theoclaw',
      'projects',
      encodeProjectDir(source.workspace),
    )
    mkdirSync(projects, { recursive: true })
    writeFileSync(join(projects, 'session.jsonl'), '{"turn":"kept"}\n')
    const dir = join(tempDir(), 'backup')
    backupInstance(source.env, dir, HOME(source))
    const target = instance()
    restoreInstance(target.env, dir, HOME(target))
    const moved = join(
      target.workspace,
      '.theoclaw',
      'projects',
      encodeProjectDir(target.workspace),
      'session.jsonl',
    )
    expect(readFileSync(moved, 'utf8')).toBe('{"turn":"kept"}\n')
  })

  it('restore refuses a backup whose state or workspace is a symbolic link, and writes nothing', async () => {
    const { symlinkSync } = await import('node:fs')
    const { dir } = backedUp()
    const elsewhere = tempDir()
    renameSync(join(dir, 'workspace'), join(elsewhere, 'workspace'))
    symlinkSync(join(elsewhere, 'workspace'), join(dir, 'workspace'))
    const target = instance()
    expect(() => restoreInstance(target.env, dir, HOME(target))).toThrow(/is a symbolic link/)
    expect(existsSync(target.state)).toBe(false)
  })

  it('backup and restore refuse a workspace inside the state directory', () => {
    const source = populated()
    const env = { ...source.env, THEOCLAW_WORKSPACE: join(source.state, 'workspace') }
    expect(() => backupInstance(env, join(tempDir(), 'b'), HOME(source))).toThrow(/overlap/)
    expect(() => restoreInstance(env, join(tempDir(), 'b'), HOME(source))).toThrow(/overlap/)
  })

  it('restore refuses while instance.lock names a live process', async () => {
    const { dir } = backedUp()
    const target = instance()
    const holder = lockChild(target.state)
    expect(await holder.answer).toBe('took')
    expect(() => restoreInstance(target.env, dir, HOME(target))).toThrow(
      `is held by process ${holder.pid}`,
    )
    expect(existsSync(target.workspace)).toBe(false)
    await holder.end()
  })

  it("a start launched while a child process runs a backup of a 200-file fixture is refused, and the backup's manifest verifies (concurrent test)", async () => {
    const source = populated()
    for (let n = 0; n < 200; n += 1)
      writeFileSync(join(source.workspace, `file-${n}.txt`), `content ${n}`)
    const dir = join(tempDir(), 'backup')
    const gate = join(tempDir(), 'go')
    const script = join(tempDir(), 'backup.ts')
    writeFileSync(
      script,
      [
        `import { existsSync, writeFileSync } from "node:fs";`,
        `import { backupInstance } from ${JSON.stringify(join(APP_DIR, 'src', 'backup', 'backup.ts'))};`,
        `let paused = false;`,
        `backupInstance(JSON.parse(process.argv[2]), process.argv[3], { homeDir: process.argv[5], onFileCopied: () => {`,
        `  if (paused) return; paused = true; process.stdout.write("copying\\n");`,
        `  while (!existsSync(process.argv[4])) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);`,
        `} });`,
        `process.stdout.write("done\\n");`,
      ].join('\n'),
    )
    const child = spawn(
      process.execPath,
      ['--import', TSX_LOADER, script, JSON.stringify(source.env), dir, gate, source.root],
      { stdio: ['ignore', 'pipe', 'inherit'] },
    )
    children.push(child)
    let output = ''
    child.stdout!.on('data', (chunk: Buffer) => (output += chunk.toString()))
    await waitFor(() => output.includes('copying'), 30_000, 'the backup to start copying')

    expect(() => claimInstance(NO_PROFILE, { THEOCLAW_STATE_DIR: source.state })).toThrow(
      `is held by process ${child.pid}`,
    )
    writeFileSync(gate, '')
    await waitFor(() => output.includes('done'), 30_000, 'the backup to finish')

    const target = instance()
    restoreInstance(target.env, dir, HOME(target))
    expect(readdirSync(target.workspace).filter((name) => name.startsWith('file-'))).toHaveLength(
      200,
    )
  }, 60_000)
})
