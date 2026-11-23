/**
 * B-400 Phase 3 (FR-008 to FR-010, NFR-002, NFR-003): the instance lock, `theoclaw backup` and
 * `theoclaw restore`. Child processes are real processes, so a pid is a real holder.
 */
import { type ChildProcess, spawn } from 'node:child_process'
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
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

import {
  backupInstance,
  BackupRefusal,
  type Manifest,
  restoreInstance,
} from '../src/backup/backup.js'
import { InstanceLockedError } from '@theokit/sdk/persistence'

import { claimInstance, NO_PROFILE, removeOwnLockSync, takeInstanceLock } from '../src/instance.js'
import { waitFor } from './fakes.js'

const APP_DIR = fileURLToPath(new URL('..', import.meta.url))
const TSX_LOADER = import.meta.resolve('tsx')
const SDK_PERSISTENCE = import.meta.resolve('@theokit/sdk/persistence')

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
async function staleLock(stateDir: string): Promise<void> {
  writeFileSync(
    `${resolve(stateDir)}.instance.lock`,
    JSON.stringify({ pid: await deadPid(), nonce: 'a'.repeat(32) }),
    { mode: 0o600 },
  )
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
  const script = join(tempDir(), 'take.mts')
  writeFileSync(
    script,
    [
      `import { existsSync, mkdirSync } from "node:fs";`,
      `import { dirname, resolve } from "node:path";`,
      `import { acquireInstanceLock } from ${JSON.stringify(SDK_PERSISTENCE)};`,
      `mkdirSync(dirname(resolve(process.argv[2])), { recursive: true });`,
      `const gate = process.argv[3];`,
      `while (gate !== undefined && !existsSync(gate)) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2);`,
      `let release = async () => {};`,
      `try { const lock = await acquireInstanceLock(process.argv[2]); release = () => lock.release(); process.stdout.write("took\\n"); }`,
      `catch (error) { process.stdout.write("refused " + error.message + "\\n"); }`,
      `process.stdin.on("end", () => { release().then(() => process.exit(0)); });`,
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
  const script = join(tempDir(), 'race.mts')
  writeFileSync(
    script,
    [
      `import { existsSync } from "node:fs";`,
      `import { join } from "node:path";`,
      `import { acquireInstanceLock } from ${JSON.stringify(SDK_PERSISTENCE)};`,
      `const pause = () => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2);`,
      `for (let round = 0; round < Number(process.argv[3]); round += 1) {`,
      `  const dir = join(process.argv[2], "round-" + round);`,
      `  process.stdout.write("ready\\n");`,
      `  while (!existsSync(join(dir, "go"))) pause();`,
      `  let release = async () => {};`,
      `  try { const lock = await acquireInstanceLock(join(dir, "state")); release = () => lock.release(); process.stdout.write("took\\n"); }`,
      `  catch (error) { process.stdout.write("refused " + error.message + "\\n"); }`,
      `  while (!existsSync(join(dir, "done"))) pause();`,
      `  await release();`,
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
  it('the exit-time removal deletes a lock this process holds and leaves one taken over by another pid', async () => {
    const stateDir = join(tempDir(), 'state')
    const lock = await takeInstanceLock(stateDir)
    removeOwnLockSync(lock.path)
    expect(existsSync(lock.path)).toBe(false)
    writeFileSync(lock.path, JSON.stringify({ pid: await deadPid(), nonce: 'b'.repeat(32) }))
    removeOwnLockSync(lock.path)
    expect(existsSync(lock.path)).toBe(true)
    removeOwnLockSync(join(tempDir(), 'absent.lock'))
  })

  it('a second take of a held lock is refused naming the pid', async () => {
    const stateDir = join(tempDir(), 'state')
    const lock = await takeInstanceLock(stateDir)
    await expect(takeInstanceLock(stateDir)).rejects.toThrow(InstanceLockedError)
    await expect(takeInstanceLock(stateDir)).rejects.toThrow(`pid ${process.pid}`)
    await lock.release()
    await (await takeInstanceLock(stateDir)).release()
  })

  it('lives beside the state directory, copies into no backup of it, and is gone after release', async () => {
    const root = tempDir()
    const lock = await takeInstanceLock(join(root, 'state'))
    expect(lock.path).toBe(join(root, 'state.instance.lock'))
    expect(existsSync(join(root, 'state'))).toBe(false)
    await lock.release()
    expect(readdirSync(root)).toEqual([])
  })

  it('a lock whose process is gone is taken over', async () => {
    const stateDir = join(tempDir(), 'state')
    await staleLock(stateDir)
    const lock = await takeInstanceLock(stateDir)
    expect(JSON.parse(readFileSync(lock.path, 'utf8')).pid).toBe(process.pid)
    await lock.release()
  })

  it('a start is refused naming the pid while a backup holds the lock', async () => {
    const root = tempDir()
    const stateDir = join(root, 'state')
    const holder = lockChild(stateDir)
    expect(await holder.answer).toBe('took')
    const env: NodeJS.ProcessEnv = { THEOCLAW_STATE_DIR: stateDir }
    await expect(claimInstance(NO_PROFILE, env)).rejects.toThrow(`pid ${holder.pid}`)
    await holder.end()
    await (await claimInstance(NO_PROFILE, env))?.release()
  })

  it("a start refused by a restore's lock leaves an absent state target absent", async () => {
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
    const holder = lockChild(stateDirectory)
    expect(await holder.answer).toBe('took')
    await expect(claimInstance(instance, {})).rejects.toThrow(InstanceLockedError)
    expect(existsSync(instance.workspace)).toBe(false)
    expect(existsSync(stateDirectory)).toBe(false)
    await holder.end()
  })

  it('a start with no state directory takes no lock', async () => {
    expect(await claimInstance(NO_PROFILE, {})).toBeUndefined()
    expect(await claimInstance(NO_PROFILE, { THEOCLAW_STATE_DIR: '  ' })).toBeUndefined()
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
        expect(JSON.parse(readFileSync(`${stateDir}.instance.lock`, 'utf8')).pid).toBe(
          winners[0]!.pid,
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
  it('backup files are written 0600 and directories 0700', async () => {
    const source = populated()
    const dir = join(tempDir(), 'backup')
    await backupInstance(source.env, dir, HOME(source))
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

  it('backup refuses a target directory that is not empty', async () => {
    const source = populated()
    const dir = tempDir()
    writeFileSync(join(dir, 'keep.txt'), 'mine')
    await expect(backupInstance(source.env, dir, HOME(source))).rejects.toThrow(/is not empty/)
    expect(readdirSync(dir)).toEqual(['keep.txt'])
  })

  it('a backup leaves out the migration import, and no byte it writes contains a configured or imported secret', async () => {
    const source = populated()
    const dir = join(tempDir(), 'backup')
    const manifest = await backupInstance(source.env, dir, HOME(source))
    expect(
      manifest.files.map((entry) => entry.path).filter((path) => path.startsWith('state/')),
    ).toEqual(['state/pairing.json'])
    for (const file of filesUnder(dir)) {
      const bytes = readFileSync(file, 'utf8')
      expect(bytes).not.toContain(SECRET)
      expect(bytes).not.toContain(IMPORTED_SECRET)
    }
  })

  it('backup refuses naming THEOCLAW_STATE_DIR when it is unset', async () => {
    const source = populated()
    const env = { ...source.env, THEOCLAW_STATE_DIR: undefined }
    await expect(backupInstance(env, join(tempDir(), 'b'), HOME(source))).rejects.toThrow(
      /THEOCLAW_STATE_DIR is unset/,
    )
  })

  it('backup refuses a directory inside the workspace it copies (EC-2)', async () => {
    const source = populated()
    const dir = join(source.workspace, 'backups', 'today')
    await expect(backupInstance(source.env, dir, HOME(source))).rejects.toThrow(
      new RegExp(`${dir}.*inside ${source.workspace}`),
    )
    expect(existsSync(join(source.workspace, 'backups'))).toBe(false)
  })

  it('backup refuses a symbolic link in a source, naming it', async () => {
    const source = populated()
    const { symlinkSync } = await import('node:fs')
    symlinkSync('/etc/hostname', join(source.workspace, 'link'))
    const dir = join(tempDir(), 'backup')
    await expect(backupInstance(source.env, dir, HOME(source))).rejects.toThrow(/link is a symbolic link/)
    expect(existsSync(dir)).toBe(false)
  })

  it('backup refuses while instance.lock names a live process', async () => {
    const source = populated()
    const holder = lockChild(source.state)
    expect(await holder.answer).toBe('took')
    const dir = join(tempDir(), 'backup')
    await expect(backupInstance(source.env, dir, HOME(source))).rejects.toThrow(
      `pid ${holder.pid}`,
    )
    expect(existsSync(dir)).toBe(false)
    await holder.end()
  })
})

describe('theoclaw restore (FR-009)', () => {
  async function backedUp(source: Instance = populated()): Promise<{ source: Instance; dir: string; manifest: Manifest }> {
    const dir = join(tempDir(), 'backup')
    return { source, dir, manifest: await backupInstance(source.env, dir, HOME(source)) }
  }

  it('a backup restored into an empty profile reproduces every file byte for byte', async () => {
    const { source, dir, manifest } = await backedUp()
    const target = instance()
    const started = Date.now()
    await restoreInstance(target.env, dir, HOME(target))
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

  it('restore refuses a non-empty workspace and writes nothing', async () => {
    const { dir } = await backedUp()
    const target = instance()
    mkdirSync(target.workspace, { recursive: true })
    writeFileSync(join(target.workspace, 'mine.txt'), 'keep')
    await expect(restoreInstance(target.env, dir, HOME(target))).rejects.toThrow(
      new RegExp(`${target.workspace} is not empty`),
    )
    expect(readdirSync(target.workspace)).toEqual(['mine.txt'])
    expect(existsSync(target.state)).toBe(false)
  })

  it('restore refuses a file whose sha256 differs, naming its path', async () => {
    const { dir } = await backedUp()
    const tampered = join(dir, 'workspace', '.theoclaw', 'sessions', 'session-1.jsonl')
    const bytes = readFileSync(tampered)
    bytes[0] = bytes[0]! ^ 1
    writeFileSync(tampered, bytes)
    const target = instance()
    await expect(restoreInstance(target.env, dir, HOME(target))).rejects.toThrow(
      /workspace\/\.theoclaw\/sessions\/session-1\.jsonl does not match its sha256/,
    )
    expect(existsSync(target.state)).toBe(false)
    expect(existsSync(target.workspace)).toBe(false)
  })

  it('restore refuses a manifest entry that leaves its root, and writes nothing (EC-3)', async () => {
    const { dir } = await backedUp()
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
      await expect(restoreInstance(target.env, dir, HOME(target))).rejects.toThrow(BackupRefusal)
      await expect(restoreInstance(target.env, dir, HOME(target))).rejects.toThrow(
        /leaves state\/ and workspace\//,
      )
      writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest))
    }
    expect(existsSync(target.state)).toBe(false)
    expect(existsSync(join(target.root, 'outside'))).toBe(false)
  })

  it('a restore that fails midway leaves the target unchanged and a retry succeeds (EC-1)', async () => {
    const { dir, manifest } = await backedUp()
    const target = instance()
    let copied = 0
    const failing = {
      ...HOME(target),
      onFileCopied: () => {
        copied += 1
        if (copied === 2) throw new Error('disk full')
      },
    }
    await expect(restoreInstance(target.env, dir, failing)).rejects.toThrow('disk full')
    expect(existsSync(target.state)).toBe(false)
    expect(existsSync(target.workspace)).toBe(false)
    expect(readdirSync(target.root).filter((name) => name.includes('.restore-'))).toEqual([])
    await restoreInstance(target.env, dir, HOME(target))
    expect(filesUnder(target.state).length + filesUnder(target.workspace).length).toBe(
      manifest.files.length,
    )
  })

  it('a backup written before the package switch restores, re-homing its transcripts', async () => {
    const { encodeProjectDir } = await import('@theokit/sdk/persistence')
    const { createHash } = await import('node:crypto')
    const source = populated()
    const projects = join(source.workspace, '.theoclaw', 'projects', encodeProjectDir(source.workspace))
    mkdirSync(projects, { recursive: true })
    writeFileSync(join(projects, 'session.jsonl'), '{"turn":"old"}\n')
    const { dir } = await backedUp(source)
    // The manifest the app wrote before the switch: no `roots`, the workspace recorded.
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as Manifest & { roots?: unknown }
    delete manifest.roots
    for (const entry of manifest.files) {
      expect(createHash('sha256').update(readFileSync(join(dir, entry.path))).digest('hex')).toBe(entry.sha256)
    }
    const legacy = JSON.stringify(manifest, null, 2)
    writeFileSync(join(dir, 'manifest.json'), legacy)
    const target = instance()
    await restoreInstance(target.env, dir, HOME(target))
    expect(readFileSync(join(target.state, 'pairing.json'), 'utf8')).toContain('paired')
    expect(
      readFileSync(join(target.workspace, '.theoclaw', 'projects', encodeProjectDir(target.workspace), 'session.jsonl'), 'utf8'),
    ).toBe('{"turn":"old"}\n')
    expect(readFileSync(join(dir, 'manifest.json'), 'utf8')).toBe(legacy)
  })

  it('a restore that cannot place the workspace leaves a state target that existed empty as it was', async () => {
    const { dir } = await backedUp()
    const target = instance()
    mkdirSync(target.state, { recursive: true })
    chmodSync(target.state, 0o750)
    // The workspace's parent is a file, so the workspace cannot be staged.
    writeFileSync(join(target.root, 'blocked'), 'x')
    const env = { ...target.env, THEOCLAW_WORKSPACE: join(target.root, 'blocked', 'workspace') }
    await expect(restoreInstance(env, dir, HOME(target))).rejects.toThrow()
    expect(readdirSync(target.state)).toEqual([])
    expect(statSync(target.state).mode & 0o777).toBe(0o750)
  })

  it('restore into an absent profile while holding the instance lock places both targets', async () => {
    const { dir } = await backedUp()
    const home = tempDir()
    const target = {
      root: home,
      env: { THEOCLAW_PROFILE: 'restored', XDG_CONFIG_HOME: join(home, 'config') },
    }
    await restoreInstance(target.env, dir, { homeDir: home })
    const profile = join(home, '.theokit', 'profiles', 'restored')
    expect(readdirSync(join(profile, 'workspace', '.theoclaw', 'sessions'))).toHaveLength(3)
    expect(readFileSync(join(profile, 'state', 'pairing.json'), 'utf8')).toContain('paired')
    expect(existsSync(`${join(profile, 'state')}.instance.lock`)).toBe(false)
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
    await backupInstance(source.env, dir, HOME(source))
    const target = instance()
    await restoreInstance(target.env, dir, HOME(target))
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
    const { dir } = await backedUp()
    const elsewhere = tempDir()
    renameSync(join(dir, 'workspace'), join(elsewhere, 'workspace'))
    symlinkSync(join(elsewhere, 'workspace'), join(dir, 'workspace'))
    const target = instance()
    await expect(restoreInstance(target.env, dir, HOME(target))).rejects.toThrow(/is a symbolic link/)
    expect(existsSync(target.state)).toBe(false)
  })

  it('backup and restore refuse a workspace inside the state directory', async () => {
    const source = populated()
    const env = { ...source.env, THEOCLAW_WORKSPACE: join(source.state, 'workspace') }
    await expect(backupInstance(env, join(tempDir(), 'b'), HOME(source))).rejects.toThrow(/overlap/)
    await expect(restoreInstance(env, join(tempDir(), 'b'), HOME(source))).rejects.toThrow(/overlap/)
  })

  it('restore refuses while instance.lock names a live process', async () => {
    const { dir } = await backedUp()
    const target = instance()
    const holder = lockChild(target.state)
    expect(await holder.answer).toBe('took')
    await expect(restoreInstance(target.env, dir, HOME(target))).rejects.toThrow(
      `pid ${holder.pid}`,
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
    const script = join(tempDir(), 'backup.mts')
    writeFileSync(
      script,
      [
        `import { existsSync, writeFileSync } from "node:fs";`,
        `import { backupInstance } from ${JSON.stringify(join(APP_DIR, 'src', 'backup', 'backup.ts'))};`,
        `let paused = false;`,
        `await backupInstance(JSON.parse(process.argv[2]), process.argv[3], { homeDir: process.argv[5], onFileCopied: () => {`,
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

    await expect(claimInstance(NO_PROFILE, { THEOCLAW_STATE_DIR: source.state })).rejects.toThrow(
      `pid ${child.pid}`,
    )
    writeFileSync(gate, '')
    await waitFor(() => output.includes('done'), 30_000, 'the backup to finish')

    const target = instance()
    await restoreInstance(target.env, dir, HOME(target))
    expect(readdirSync(target.workspace).filter((name) => name.startsWith('file-'))).toHaveLength(
      200,
    )
  }, 60_000)
})
