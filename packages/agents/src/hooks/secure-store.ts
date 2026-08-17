/**
 * The disk half of a consent store: owner-only permissions, atomic replace, fail-closed reads.
 *
 * ## Why this is shared and not written twice
 *
 * Two stores need it — hook approvals and tool-permission grants — and both decide whether something
 * runs on the operator's machine. The Rule of 3 says extract on the third repetition; a SECURITY
 * helper is the case where two is already enough, because the cost of the two copies drifting is a
 * permission check that exists in one place and not the other.
 *
 * ## The three things it does that a consumer gets wrong
 *
 * 1. **Repairs the directory mode before asserting it.** `mkdirSync(dir, { mode })` is a **no-op on
 *    an existing directory**, and this directory is shared with the SDK's transcript root — whoever
 *    creates it first sets the permissions. A store that only ASSERTS would fail closed forever on a
 *    machine the SDK set up first; one that only CREATES inherits whatever it found. So: chmod, then
 *    assert.
 * 2. **Replaces atomically.** Write to a temp file in the same directory, then `rename`. A reader
 *    never observes a partial file, and a crash leaves either the old content or the new one.
 * 3. **Fails closed AND reports.** An unreadable or corrupt store yields an empty result — never a
 *    throw that takes down the turn, and never a silent empty that is indistinguishable from "no
 *    approvals yet". The caller gets the error to surface (`error-handling.md § 2`).
 */
import { randomUUID } from 'node:crypto'
import { chmodSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** Group-write (0o020) and other-write (0o002): the bits that let another user edit the decision. */
const FORBIDDEN_WRITE_BITS = 0o022

/** Owner-only, for both the directory and the file. */
const DIR_MODE = 0o700
const FILE_MODE = 0o600

/**
 * @knipignore — exported because it is the return type of the exported `readSecureJson`. No module
 * imports it by name, which is what knip measures; un-exporting it would make the public signature
 * reference a private name.
 */
export interface SecureStoreRead<T> {
  /** Parsed content, or the empty value when the store is absent, empty or unreadable. */
  readonly value: T
  /**
   * Why the store could not be read, when it could not be.
   *
   * Present ONLY for a store that exists and failed — an absent store is the ordinary first-run
   * state, not an error. A caller surfaces this; swallowing it makes "your approvals stopped
   * applying" indistinguishable from "you have none".
   */
  readonly error?: Error
}

/**
 * Ensure the containing directory is owner-only, repairing it when it is not.
 *
 * @throws when the mode cannot be repaired — refusing beats running with a store another user can
 *   rewrite, because that store decides what executes.
 */
export function ensureSecureDir(filePath: string): void {
  const dir = dirname(filePath)
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- the path is the caller's own store location, built from a home directory it owns; the filename is the fixed convention. Refusing dynamic paths here would mean refusing the store.
  mkdirSync(dir, { recursive: true, mode: DIR_MODE })

  // eslint-disable-next-line security/detect-non-literal-fs-filename -- the path is the caller's own store location, built from a home directory it owns; the filename is the fixed convention. Refusing dynamic paths here would mean refusing the store.
  const mode = statSync(dir).mode & 0o777
  if ((mode & FORBIDDEN_WRITE_BITS) !== 0) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- the path is the caller's own store location, built from a home directory it owns; the filename is the fixed convention. Refusing dynamic paths here would mean refusing the store.
    chmodSync(dir, DIR_MODE)
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- the path is the caller's own store location, built from a home directory it owns; the filename is the fixed convention. Refusing dynamic paths here would mean refusing the store.
    const repaired = statSync(dir).mode & 0o777
    if ((repaired & FORBIDDEN_WRITE_BITS) !== 0) {
      throw new Error(
        `${dir} is mode ${repaired.toString(8)} — group or world writable, and the repair did not ` +
          `hold. This directory decides which commands may run, so a writable one is a way to grant ` +
          `that to yourself. Fix with \`chmod 700 ${dir}\`.`,
      )
    }
  }
}

/**
 * Read and parse, failing closed.
 *
 * @param empty the value a caller gets when there is nothing trustworthy to return
 */
export function readSecureJson<T>(
  filePath: string,
  parse: (raw: string) => T,
  empty: T,
): SecureStoreRead<T> {
  let raw: string
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- the path is the caller's own store location, built from a home directory it owns; the filename is the fixed convention. Refusing dynamic paths here would mean refusing the store.
    raw = readFileSync(filePath, 'utf8')
  } catch {
    // Absent is the ordinary first-run state. Not an error, and not worth reporting.
    return { value: empty }
  }

  // The FILE's mode, not just the directory's. `ensureSecureDir` held the directory to owner-only
  // and the read then opened the file without looking — so a store left group- or world-writable by
  // an older version, a bad umask, or anyone with write access to it was believed. This file decides
  // which command lines reach `spawn(cmd, { shell: true })`.
  //
  // Refused HERE rather than repaired: silently tightening the mode would hide that something
  // changed it, which is the fact worth knowing.
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- same store path, already read above
  const fileMode = statSync(filePath).mode & 0o777
  if ((fileMode & FORBIDDEN_WRITE_BITS) !== 0) {
    return {
      value: empty,
      error: new Error(
        `${filePath} is mode ${fileMode.toString(8)} — group or world writable, so another local ` +
          `user can decide what it says. It is being treated as empty: every entry in it has ` +
          `stopped applying. Fix with \`chmod 600 ${filePath}\`.`,
      ),
    }
  }

  // A zero-byte file is what a crash mid-write leaves behind, and `JSON.parse('')` throws.
  if (raw.trim().length === 0) return { value: empty }

  try {
    return { value: parse(raw) }
  } catch (cause) {
    return {
      value: empty,
      error: new Error(
        `${filePath} could not be parsed and is being treated as empty — every entry in it has ` +
          `stopped applying. Inspect or delete it. Cause: ${cause instanceof Error ? cause.message : String(cause)}`,
      ),
    }
  }
}

/**
 * The path of the temp file a write to `filePath` will stage through.
 *
 * Its own function because uniqueness is a property worth asserting directly. The previous name was
 * `Date.now()` + pid, and measured, **twelve writes from one process produced one name** — two
 * writers then race on the same path and the second `rename` of an already-renamed temp throws
 * `ENOENT`. Serialised sync calls on a single thread never collide, which is why the suite was
 * green; `worker_threads` share a pid and do not.
 *
 * `randomUUID` and not a clock, per `system-design-guardrails.md` G8: a timestamp is a poor source
 * of identity precisely because two events can share one.
 *
 * Beside the store, never in the system temp dir: `rename` is atomic only within a filesystem, and a
 * cross-device temp degrades to a copy a reader can catch halfway.
 */
export function tempPathFor(filePath: string): string {
  return join(dirname(filePath), `.${randomUUID()}.tmp`)
}

/** Replace the file atomically, owner-only. */
export function writeSecureJson(filePath: string, serialize: () => string): void {
  ensureSecureDir(filePath)
  const tmp = tempPathFor(filePath)
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- the path is the caller's own store location, built from a home directory it owns; the filename is the fixed convention. Refusing dynamic paths here would mean refusing the store.
  writeFileSync(tmp, serialize(), { encoding: 'utf8', mode: FILE_MODE })
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- the path is the caller's own store location, built from a home directory it owns; the filename is the fixed convention. Refusing dynamic paths here would mean refusing the store.
  renameSync(tmp, filePath)
  // Defence in depth, and honestly labelled as such. The earlier justification here — "an existing
  // target may have a wider mode" — was measured and is FALSE: `rename` replaces the target inode,
  // so the old mode never survives. What `mode` genuinely does not cover is a temp that already
  // exists, since `writeFileSync` ignores `mode` on an existing file; `tempPathFor` now makes that
  // unreachable by construction. The line stays because asserting the mode costs one syscall and
  // the alternative is trusting an invariant that lives in another function.
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- the path is the caller's own store location, built from a home directory it owns; the filename is the fixed convention. Refusing dynamic paths here would mean refusing the store.
  chmodSync(filePath, FILE_MODE)
}
