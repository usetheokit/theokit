import { TrustStore } from '@theokit/agents/config'

import { DEFAULT_HOME_DIR, homeStateDir } from './home-dir.js'

import { existsSync, readFileSync, realpathSync, renameSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

/**
 * The consent record, under whatever root `home_dir` resolved to.
 *
 * A function rather than the module-level const this replaced. That const called `homedir()` at
 * IMPORT time and pinned `.theokit`, so `home_dir` — documented as "the directory this product keeps
 * its state in" — moved the transcripts, the projects root and the collector, and left the record of
 * which directories may run code sitting in a directory the product otherwise stopped using.
 *
 * `THEOKIT_HOME` is read rather than the config key, because both surfaces install it at bootstrap
 * from that key (`installTheokitHome`) and the SDK reads the same variable. One resolved answer, not
 * a second resolution that can disagree with the first.
 */
export function trustStorePath(
  env: Record<string, string | undefined> = process.env,
  home: string = homedir(),
): string {
  return join(homeStateDir(env, home), 'trusted-dirs.json')
}

/** The root every installation had before `home_dir` existed, read but never written. */
const legacyRootStore = (home: string): string => join(home, DEFAULT_HOME_DIR, 'trusted-dirs.json')

/**
 * B-005 — the one canonical form for a directory used as a consent key.
 *
 * Directory trust keyed on this; hook approvals keyed on the raw string. Two spellings of the same
 * path (a symlink, a `..` segment) were therefore the same directory for one decision and two for
 * the other. The divergence is fail-safe rather than fail-open — an approval under one spelling does
 * not leak to another — but a consent store where the same fact has two keys is one nobody can audit.
 */
export function canonical(dir: string): string {
  try {
    return realpathSync(dir)
  } catch {
    return resolve(dir)
  }
}

/**
 * B-005 — refuse a store any other local user can write.
 *
 * This file decides which directories are trusted and which hook command lines are pre-approved, and
 * a hook is `spawn(cmd, { shell: true, detached: true })`. Reading a group/other-writable copy as
 * authoritative hands command execution to whoever can write it.
 *
 * A missing file is NOT an error: a first run has no store, and that means "nothing is trusted yet".
 */
function assertPrivate(store: string): void {
  // B-019 — the directory is part of the answer. A 0600 file inside a directory others can write is
  // not private: the file can be replaced wholesale, and the replacement's mode is set by whoever
  // wrote it. Checking the file alone answers a narrower question than the one asked.
  //
  // The directory is held to WORLD-write only (0o002), not to the file's 0o022. Group-write on a
  // directory is the DEFAULT under umask 002 — a fresh `mkdir` yields 0775, and on a distro with
  // per-user private groups that group contains only the owner. Refusing it would reject the
  // ordinary configuration of most Linux desktops, and a gate that fires on the default is one
  // people disable. World-write is unambiguous: it is a real third party, and it is rare.
  //
  // The file keeps 0o022 because this code creates it 0600 itself, so group-write on it is
  // anomalous rather than inherited.
  assertNotWritableByOthers(dirname(store), 0o002, 'chmod 700')
  assertNotWritableByOthers(store, 0o022, 'chmod 600')
}

function assertNotWritableByOthers(target: string, forbidden: number, remedy: string): void {
  let mode: number
  try {
    mode = statSync(target).mode
  } catch {
    return
  }
  if ((mode & forbidden) !== 0) {
    throw new Error(
      `refusing to read ${target}: it is group- or world-writable (mode ` +
        `${(mode & 0o777).toString(8)}). It authorises directory trust and pre-approved hook ` +
        `commands, so anyone who can write it can run commands as you. Fix with: ${remedy} ` +
        `${target}`,
    )
  }
}

/**
 * The one gated reader of the consent store. Exported because it is a gate, and a gate that only
 * one of two consumers can reach is not one: `hook-trust.ts` kept a private, ungated copy of this
 * function precisely because this one was module-private (B-019).
 *
 * Throws when the store or its directory is writable by anyone else. A MISSING file is not an
 * error — a first run has no store, and that means "nothing is trusted yet".
 */
function readDocument(store: string): Record<string, unknown> {
  assertPrivate(store)
  try {
    const parsed: unknown = JSON.parse(readFileSync(store, 'utf8'))
    return parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/**
 * Directory trust — a FACADE over the framework's `TrustStore` since 2026-08-15.
 *
 * The membership list, the canonical key and the atomic write all live in
 * `@theokit/agents/config` now. The framework version is stricter in the one place that matters: it
 * canonicalises with `realpath` on BOTH sides of the comparison, which is the defect B-005
 * documented here in prose and only half fixed. It could not move earlier — the framework store had
 * no `isTrusted` and keyed records by the raw string until `@theokit/agents@8.7.0`, which landed
 * measured against this file.
 *
 * ## The one-time migration
 *
 * The legacy document is `{ trusted: [dir, …], hooks: { … } }` — one file holding two different
 * consents. The framework store owns its own file, so `migrateLegacyTrust` carries the trusted
 * directories across and leaves `hooks` alone for `hook-trust.ts`.
 *
 * Lossless in this direction: a legacy entry means "this directory was trusted", and the framework
 * record says exactly that. `decidedAt` is the migration's own timestamp and `decidedBy` says
 * `legacy-migration` — nothing is invented about when or by whom the original decision was made.
 */
export const frameworkPathFor = (legacy: string): string =>
  `${legacy.replace(/\.json$/, '')}.v2.json`

/** Renamed rather than deleted, so an operator can still read what the legacy document held. */
const migratedMarkerFor = (legacy: string): string => `${legacy}.migrated`

/**
 * Carry `{ trusted: [...] }` into the framework store, once.
 *
 * NEVER throws: a failed migration must not stop the product from asking for consent the normal
 * way, which is the safe fallback. Idempotent — `trust` replaces the record for a directory, so a
 * second pass adds nothing.
 */
/**
 * Not exported: `trustDir` calls it, and `isTrusted` already reads the legacy document, so no caller
 * needs to trigger the migration by hand. An exported entry point nobody calls is surface that
 * suggests a step someone must remember — and the whole point of the dual read is that they do not.
 */
async function migrateLegacyTrust(store: string): Promise<void> {
  if (!existsSync(store) || existsSync(migratedMarkerFor(store))) return

  // Declared without an initialiser: the `catch` returns, so the only way past this block is
  // through the assignment below. An `= []` here would read as a fallback that can never be used.
  let dirs: string[]
  try {
    const parsed = JSON.parse(readFileSync(store, 'utf8')) as { trusted?: unknown }
    dirs = Array.isArray(parsed.trusted)
      ? parsed.trusted.filter((d): d is string => typeof d === 'string')
      : []
  } catch {
    return
  }

  const trustStore = new TrustStore(frameworkPathFor(store))
  for (const dir of dirs) {
    await trustStore.trust({
      path: dir,
      decidedAt: new Date().toISOString(),
      decidedBy: 'legacy-migration',
      trusted: true,
    })
  }

  try {
    renameSync(store, migratedMarkerFor(store))
  } catch {
    // Losing the marker only means the migration re-runs, and it is idempotent.
  }
}

/**
 * Both sources are consulted, and that is deliberate.
 *
 * A first draft read only the framework store, which made `isTrusted` fail-closed before the
 * migration ran — technically safe, and wrong in practice: a directory the operator already trusted
 * would be asked about again, and being asked again about something you already decided is exactly
 * how a person learns to approve without reading. The legacy document stays readable until
 * `migrateLegacyTrust` consumes it, so a decision is never silently lost.
 *
 * The legacy read goes through `readDocument`, which keeps the private-mode gate: a store any local
 * user can write is refused rather than believed.
 */
export function isTrusted(
  dir: string,
  store: string = trustStorePath(),
  home: string = homedir(),
): boolean {
  if (new TrustStore(frameworkPathFor(store)).isTrusted(dir)) return true
  if (legacyTrusted(store).includes(canonical(dir))) return true

  // The root the operator had before `home_dir` existed. Read only when the configured root is not
  // it, and only for reading: moving the root must not re-ask about directories already decided,
  // because being asked again about a settled question is how a person learns to approve without
  // reading — the reasoning below, applied to the root instead of the document shape.
  const legacy = legacyRootStore(home)
  if (legacy === store) return false
  return (
    new TrustStore(frameworkPathFor(legacy)).isTrusted(dir) ||
    legacyTrusted(legacy).includes(canonical(dir))
  )
}

/** The legacy `{ trusted: [...] }` list, or empty when there is none. */
function legacyTrusted(store: string): string[] {
  const doc = readDocument(store)
  return Array.isArray(doc.trusted)
    ? doc.trusted.filter((d): d is string => typeof d === 'string')
    : []
}

export async function trustDir(dir: string, store: string = trustStorePath()): Promise<void> {
  await migrateLegacyTrust(store)
  await new TrustStore(frameworkPathFor(store)).trust({
    path: dir,
    decidedAt: new Date().toISOString(),
    decidedBy: 'operator',
    trusted: true,
  })
}
