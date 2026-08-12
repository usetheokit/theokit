#!/usr/bin/env node
/**
 * B-M67-07 — refuse a release whose computed version already exists on the registry.
 *
 * ## The failure this closes
 *
 * `pnpm version-packages` computes the next version from the changeset files on disk plus the
 * version in each `package.json`. Both inputs come from the working branch. When that branch is
 * behind the branch a previous release landed on, both inputs are stale: the already-consumed
 * changeset files are still present, and the version they are added to is the pre-release one. The
 * result is a recomputation of a bump that already shipped.
 *
 * That happened in M67: `@theokit/agents@7.5.0` was recomputed while npm had had 7.5.0 since
 * 2026-08-10, with different content.
 *
 * `changeset publish` does not stop it, and that is precisely the danger — it *skips* a version it
 * finds on the registry. The release reports success while publishing nothing, and the local
 * CHANGELOG and the git tag are left claiming a number whose content is not what shipped under it.
 * A silent, permanent mismatch between the public record and the artifact.
 *
 * So the gate runs right after the versions are written, before anything is tagged or published, and
 * it fails loud.
 *
 * ## Which packages it checks, and why not all of them
 *
 * Only the ones whose `version` field differs from `HEAD` — that is, the ones the versioning step
 * just bumped in the working tree. Sweeping the whole workspace was the first shape and it was
 * wrong: a package that was not touched sits at exactly the version it last published, so the
 * registry has it, and the gate fired on three packages that had nothing to do with the release.
 * A gate that reports a collision for an untouched package is a gate nobody keeps.
 *
 * ## What it does NOT do
 *
 * It does not compare CONTENT. A version present on the registry is treated as a collision even in
 * the case where the bytes would be identical, because proving byte-equality would mean fetching and
 * diffing tarballs, and the answer would not change what the operator must do: merge the branch the
 * release landed on and let the version be recomputed from a current base.
 *
 * ## § PATH note
 *
 * The `npm` / `git` / `pnpm` calls below run from PATH, deliberately: a release script asks the same
 * tools the release itself runs. An absolute path would pin one installation and closes no threat in
 * a script already running with the operator's own privileges. Each call carries a one-line
 * `eslint-disable` pointing here rather than restating it four times.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

/**
 * @typedef {{ name: string, version: string, private?: boolean }} Candidate
 * @typedef {(name: string, version: string) => boolean} RegistryHasVersion
 */

/**
 * Which candidates name a version the registry already has.
 *
 * Pure, so the decision is testable without the network — the lookup is injected (DIP). Private
 * packages are skipped: they are never on the registry, so consulting it would return "absent" for a
 * reason that has nothing to do with the property being checked.
 *
 * @param {readonly Candidate[]} candidates
 * @param {RegistryHasVersion} registryHasVersion
 * @returns {Array<{ name: string, version: string }>}
 */
export function findPublishedCollisions(candidates, registryHasVersion) {
  const collisions = []
  for (const candidate of candidates) {
    if (candidate.private === true) continue
    if (registryHasVersion(candidate.name, candidate.version)) {
      collisions.push({ name: candidate.name, version: candidate.version })
    }
  }
  return collisions
}

/** `npm view <pkg>@<version> version` — a non-zero exit means the registry does not have it. */
function npmHasVersion(name, version) {
  try {
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- see § PATH note above
    const out = execFileSync('npm', ['view', `${name}@${version}`, 'version'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return out.trim().length > 0
  } catch {
    return false
  }
}

/** The version this manifest had at `HEAD`, or `undefined` when the file is new or unreadable. */
function versionAtHead(relPath) {
  try {
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- see § PATH note above
    const at = execFileSync('git', ['show', `HEAD:${relPath}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 1 << 26,
    })
    return JSON.parse(at).version
  } catch {
    return undefined
  }
}

/** Workspace packages whose `version` the working tree changed relative to `HEAD`. */
function bumpedCandidates() {
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- see § PATH note above
  const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
  }).trim()
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- see § PATH note above
  const members = execFileSync('pnpm', ['-r', 'list', '--depth', '-1', '--json'], {
    encoding: 'utf8',
    maxBuffer: 1 << 26,
  })
  return JSON.parse(members)
    .filter((m) => typeof m.path === 'string')
    .map((m) => {
      const pkg = JSON.parse(readFileSync(`${m.path}/package.json`, 'utf8'))
      const rel = `${m.path}/package.json`.slice(repoRoot.length + 1)
      return {
        name: pkg.name,
        version: pkg.version,
        private: pkg.private === true,
        previous: versionAtHead(rel),
      }
    })
    .filter((c) => typeof c.name === 'string' && typeof c.version === 'string')
    .filter((c) => c.previous !== undefined && c.previous !== c.version)
}

if (process.argv[1]?.endsWith('verify-version-not-published.mjs')) {
  const candidates = bumpedCandidates()
  if (candidates.length === 0) {
    console.log('version-collision gate: no package version changed against HEAD, nothing to check')
    process.exit(0)
  }
  const collisions = findPublishedCollisions(candidates, npmHasVersion)
  if (collisions.length > 0) {
    const list = collisions.map((c) => `  ${c.name}@${c.version}`).join('\n')
    console.error(
      `\nThe registry already has the version(s) this release just computed:\n${list}\n\n` +
        `That means the base was stale: a previous release landed on another branch and this one ` +
        `never received it, so the already-consumed changesets recomputed a bump that shipped.\n\n` +
        `Publishing now would leave the CHANGELOG and the git tag claiming a number whose content ` +
        `is not what shipped under it — \`changeset publish\` would skip the duplicate and report ` +
        `success.\n\n` +
        `Fix: merge the branch the release landed on (usually \`main\`) into this one, drop the ` +
        `changesets it already consumed, and re-run \`pnpm version-packages\`.\n`,
    )
    process.exit(1)
  }
  const names = candidates.map((c) => `${c.name}@${c.version}`).join(', ')
  console.log(`version-collision gate: ${names} — none published yet`)
}
