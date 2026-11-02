import { randomBytes } from 'node:crypto'
import { chmodSync, linkSync, mkdirSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'

import { applyInstance, type TheoClawInstance } from '../instance.js'

/** A lock a running process holds, or one this module cannot safely take over. */
export class InstanceLockedError extends Error {
  constructor(
    message: string,
    readonly lockPath: string,
    readonly pid?: number,
  ) {
    super(message)
    this.name = 'InstanceLockedError'
  }
}

/** What a holder writes into the lock: its pid and the random nonce naming its generation. */
interface LockClaim {
  readonly pid: number
  readonly nonce: string
}

export interface InstanceLock {
  readonly path: string
  readonly nonce: string
  /** Remove the lock if it is still this holder's, and every takeover file of a gone generation. */
  release(): void
}

/** Test seams: a pause between reading a stale lock and claiming its takeover file. */
export interface InstanceLockHooks {
  readonly beforeTakeover?: () => void
}

const TAKEOVER = '.takeover-'
const ATTEMPTS = 3
const TAKEOVER_PATIENCE_MS = 500
const TAKEOVER_POLL_MS = 25

/** The lock BESIDE the state directory, so a restore can hold it while the target is absent or empty. */
export function instanceLockPath(stateDir: string): string {
  const absolute = resolve(stateDir)
  return join(dirname(absolute), `${basename(absolute)}.instance.lock`)
}

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException).code
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return errorCode(error) === 'EPERM'
  }
}

function writePrivate(path: string, text: string, flag: 'w' | 'wx'): void {
  writeFileSync(path, text, { mode: 0o600, flag })
  chmodSync(path, 0o600)
}

/** The lock's claim, `undefined` when there is no lock; a lock that is not a claim is refused. */
function readClaim(path: string): LockClaim | undefined {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return undefined
    throw error
  }
  const [pidText = '', nonce = ''] = text.split('\n')
  const pid = Number(pidText)
  if (!Number.isSafeInteger(pid) || pid <= 0 || !/^[0-9a-f]{32}$/.test(nonce)) {
    throw new InstanceLockedError(`${path} is not an instance lock this version wrote; if no theoclaw process runs, delete it`, path)
  }
  return { pid, nonce }
}

function heldBy(path: string, pid: number): InstanceLockedError {
  return new InstanceLockedError(`the instance is in use: ${path} is held by process ${pid}`, path, pid)
}

/**
 * Remove every takeover file whose generation is not the lock's current one, and the claim files of
 * processes that are gone. The directory is listed BEFORE the lock is read: a takeover file listed
 * while the lock already carries another nonce names a generation that can never come back, whereas
 * reading first could delete the takeover file of a generation that went stale after the read.
 */
function removeStaleTakeovers(path: string): void {
  const names = readdirSync(dirname(path))
  const current = readClaim(path)?.nonce
  const takeover = `${basename(path)}${TAKEOVER}`
  const claim = `${basename(path)}.claim-`
  for (const name of names) {
    const claimPid = name.startsWith(claim) ? Number(name.slice(claim.length).split('-')[0]) : undefined
    const stale = name.startsWith(takeover)
      ? name.slice(takeover.length) !== current
      : claimPid !== undefined && Number.isSafeInteger(claimPid) && claimPid > 0 && !processAlive(claimPid)
    if (stale) rmSync(join(dirname(path), name), { force: true })
  }
}

/** Sleep the thread: the lock is taken before the event loop serves anything. */
function pause(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

type Attempt = { readonly taken: true } | { readonly taken: false; readonly retry: boolean }

/**
 * Take over a lock whose holder is gone, serialised per generation: only the taker that creates
 * `<lock>.takeover-<nonce>` touches the lock, and only while the lock still carries that nonce
 * with a dead pid. A nonce is never issued twice, so a takeover file of a gone generation can
 * never let anyone remove a fresh lock.
 */
function takeOver(path: string, claimPath: string, stale: LockClaim, hooks: InstanceLockHooks): Attempt {
  hooks.beforeTakeover?.()
  const takeover = `${path}${TAKEOVER}${stale.nonce}`
  try {
    writePrivate(takeover, `${process.pid}\n`, 'wx')
  } catch (error) {
    if (errorCode(error) !== 'EEXIST') throw error
    // Another taker may be mid-takeover: give it a moment before calling the takeover abandoned.
    for (let waited = 0; waited < TAKEOVER_PATIENCE_MS; waited += TAKEOVER_POLL_MS) {
      if (readClaim(path)?.nonce !== stale.nonce) return { taken: false, retry: true }
      pause(TAKEOVER_POLL_MS)
    }
    if (readClaim(path)?.nonce !== stale.nonce) return { taken: false, retry: true }
    throw new InstanceLockedError(
      `${path} names a process that is gone and ${takeover} says a takeover of it never finished; if no theoclaw process runs, delete both files`,
      path,
    )
  }
  try {
    const now = readClaim(path)
    if (now === undefined || now.nonce !== stale.nonce || processAlive(now.pid)) return { taken: false, retry: true }
    unlinkSync(path)
    linkSync(claimPath, path)
    return { taken: true }
  } catch (error) {
    if (errorCode(error) === 'EEXIST') return { taken: false, retry: true }
    throw error
  } finally {
    rmSync(takeover, { force: true })
  }
}

function attempt(path: string, claimPath: string, hooks: InstanceLockHooks): Attempt {
  try {
    linkSync(claimPath, path)
    return { taken: true }
  } catch (error) {
    if (errorCode(error) !== 'EEXIST') {
      // A filesystem without hard links (some FUSE and SMB mounts) cannot hold this lock.
      throw new InstanceLockedError(`cannot take ${path}: ${errorCode(error) ?? String(error)} (the lock needs a filesystem with hard links)`, path)
    }
  }
  const current = readClaim(path)
  if (current === undefined) return { taken: false, retry: true }
  if (processAlive(current.pid)) throw heldBy(path, current.pid)
  return takeOver(path, claimPath, current, hooks)
}

/**
 * Take `<stateDir>.instance.lock` for a start, a backup or a restore (FR-010). The claim is linked
 * in whole from a file that already holds the pid and a fresh nonce, so nobody reads it empty. A
 * live holder is refused naming its pid; a holder that is gone is taken over (see `takeOver`). A
 * holder's liveness is `kill(pid, 0)`, so processes sharing the directory must share a pid
 * namespace: a holder in another container looks gone.
 * Creates only the lock's parent directory, at 0700.
 */
export function takeInstanceLock(stateDir: string, hooks: InstanceLockHooks = {}): InstanceLock {
  const path = instanceLockPath(stateDir)
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const nonce = randomBytes(16).toString('hex')
  const claimPath = `${path}.claim-${process.pid}-${nonce}`
  writePrivate(claimPath, `${process.pid}\n${nonce}\n`, 'wx')
  try {
    for (let tries = 0; tries < ATTEMPTS; tries += 1) {
      const result = attempt(path, claimPath, hooks)
      if (result.taken) return { path, nonce, release: () => release(path, nonce) }
      if (!result.retry) break
    }
    const holder = readClaim(path)
    throw holder === undefined ? new InstanceLockedError(`${path} could not be taken`, path) : heldBy(path, holder.pid)
  } finally {
    rmSync(claimPath, { force: true })
  }
}

function release(path: string, nonce: string): void {
  try {
    if (readClaim(path)?.nonce === nonce) unlinkSync(path)
    removeStaleTakeovers(path)
  } catch (error) {
    // A lock rewritten by another version, or a directory gone: nothing of this holder is left there.
    if (!(error instanceof InstanceLockedError) && errorCode(error) !== 'ENOENT') throw error
  }
}

/** Where the start's lock goes: the instance's state directory, or `undefined` with none (no lock). */
function stateDirOf(instance: TheoClawInstance, env: NodeJS.ProcessEnv): string | undefined {
  const dir = instance.stateDirectory ?? env.THEOCLAW_STATE_DIR?.trim()
  return dir === undefined || dir === '' ? undefined : dir
}

/**
 * The start's half of FR-010: take the instance lock, then put the instance into effect. The lock
 * comes BEFORE `applyInstance` creates the targets, so a start refused by a restore's lock leaves an
 * absent target absent. An instance with no state directory has nothing to protect and takes none.
 * Returns the release, or `undefined` when no lock was taken.
 */
export function claimInstance(
  instance: TheoClawInstance,
  env: NodeJS.ProcessEnv,
  hooks: { readonly beforeLock?: () => void } = {},
): (() => void) | undefined {
  const stateDir = stateDirOf(instance, env)
  hooks.beforeLock?.()
  const lock = stateDir === undefined ? undefined : takeInstanceLock(stateDir)
  try {
    applyInstance(instance, env)
  } catch (error) {
    lock?.release()
    throw error
  }
  return lock?.release
}
