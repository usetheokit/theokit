/**
 * This repository must never resolve `theokit` from the registry (usetheokit/theokit#561).
 *
 * `theokit` is published FROM here, so the copy that matters is always `packages/theo`. Asking npm
 * for it means asking for a version this tree may not have shipped yet — and at exactly one moment
 * that is guaranteed: the release pull request, where `package.json` already says `0.60.0` and the
 * registry's newest is still `0.59.0`.
 *
 * ## What broke without this
 *
 * `dep-check`'s floor legs pin a sibling at the bottom of its declared range —
 * `pnpm.overrides["@theokit/http"] = "0.4.0"` — and reinstall. That override replaces the workspace
 * link with the published tarball, and `@theokit/http@0.4.0` declares `peerDependencies: { theokit:
 * ">=0.2.0" }`. With auto-installed peers, pnpm satisfies that peer from the REGISTRY rather than
 * from the workspace, asks for the version this tree declares, and gets:
 *
 *     ERR_PNPM_NO_MATCHING_VERSION  No matching version found for theokit@0.60.0
 *
 * Reproduced locally against the 0.60.0 release tree, and observed on two consecutive release PRs
 * (#550 for 0.59.0, #561 for 0.60.0) — the same two legs red both times, which is what made it look
 * like background noise rather than a defect.
 *
 * The override says the true thing instead: within this repository, `theokit` IS the workspace.
 *
 * ## Why this does not disarm the floor check
 *
 * `dep-check pin-one` writes into the same map, so pinning `theokit` itself overwrites this entry
 * rather than colliding with it — verified by running `pin-one --root . theokit 0.36.1` against a
 * tree carrying this override and reading the result back. The leg that pins `theokit` still pins
 * it; the legs that pin something else stop dragging an unpublished version into the resolution.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..', '..')

function rootManifest(): { pnpm?: { overrides?: Record<string, string> } } {
  return JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
    pnpm?: { overrides?: Record<string, string> }
  }
}

describe('theokit resolves to the workspace, never to the registry (#561)', () => {
  it('the root manifest overrides `theokit` to the workspace copy', () => {
    const overrides = rootManifest().pnpm?.overrides

    expect(
      overrides?.theokit,
      'without this, a sibling pinned from the registry drags its `theokit` peer to npm — ' +
        'and asks for a version this tree has not published yet',
    ).toBe('workspace:*')
  })

  it('no package depends on `theokit` by a registry range instead of the workspace', () => {
    // The override is a backstop, not a licence. A package inside this repository that names a
    // published range for its own sibling would resolve to a DIFFERENT copy than the one being
    // built the moment the override is lifted or scoped — `@theokit/tauri` already carries
    // `workspace:*` in devDependencies for exactly this reason.
    //
    // `peerDependencies` are excluded: a peer range is a statement about what a CONSUMER must
    // provide, and `>=0.36.1` there is correct precisely because it is not a resolution.
    const offenders: string[] = []
    for (const pkg of [
      'theo',
      'agents',
      'agents-pty',
      'http',
      'presenter',
      'tauri',
      'create-theokit',
    ]) {
      const manifest = JSON.parse(
        readFileSync(join(ROOT, 'packages', pkg, 'package.json'), 'utf8'),
      ) as Record<string, Record<string, string> | undefined>

      for (const field of ['dependencies', 'devDependencies']) {
        const range = manifest[field]?.theokit
        if (range !== undefined && !range.startsWith('workspace:')) {
          offenders.push(`packages/${pkg}: ${field}.theokit = ${range}`)
        }
      }
    }

    expect(offenders, 'these would resolve a sibling from npm while building it here').toEqual([])
  })
})
