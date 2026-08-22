/**
 * `pnpm try:scaffold` is this repository's own path for trying its own code, and it resolved
 * `theokit` from npm (usetheokit/theokit#420). Every local verification done through it had been
 * measuring the published package.
 *
 * Two defects, and they need different fixes:
 *
 * 1. **The harness.** The template pins a RANGE, which is correct for the people who scaffold from
 *    npm and wrong for the one caller that wants this working tree. `try:scaffold` now rewrites the
 *    scaffolded manifest to the `workspace:` protocol, which pnpm honours explicitly — so the
 *    result does not depend on `link-workspace-packages`, whose default the issue could not
 *    determine and no longer has to.
 *
 * 2. **The rot.** `^0.48.3` on a `0.x` version pins the MINOR: `>=0.48.3 <0.49.0`. The workspace was
 *    already at 0.49.0, so the range excluded the very build it was meant to admit, and nothing
 *    said so. Worse, one `try:scaffold` app could pair a LOCAL agent runtime (`@theokit/agents
 *    ^10.1.0` matches `10.1.0`) with a PUBLISHED framework — a combination that fails in ways
 *    neither version exhibits alone, and that reads as a framework bug.
 *
 * The second guard is the one that matters for real users: it fails the moment a release moves the
 * workspace out of the range the template ships, instead of at 0.50.0 when someone notices new
 * scaffolds are two minors behind.
 */
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  linkToWorkspace,
  workspacePackageNames,
  type Manifest,
} from '../../scripts/link-scaffold-to-workspace.js'

const ROOT = resolve(__dirname, '../..')
const TEMPLATE = join(ROOT, 'packages/create-theokit/templates/default/package.json.tmpl')

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
}

describe('try:scaffold resolves this working tree, not npm (#420)', () => {
  it('rewrites every workspace package to the workspace: protocol', () => {
    const names = workspacePackageNames(ROOT)
    const manifest = readJson(TEMPLATE) as {
      dependencies: Record<string, string>
      devDependencies: Record<string, string>
    }

    const linked = dependenciesOf(linkToWorkspace(manifest, names))

    // `theokit` and `@theokit/agents` are the two the default template declares; asserting over
    // the discovered set rather than that pair keeps this true when the template gains a third.
    const declared = Object.keys(manifest.dependencies).filter((d) => names.includes(d))
    expect(declared.length).toBeGreaterThan(0)
    for (const dep of declared) {
      expect(linked[dep], `${dep} must come from this repo`).toBe('workspace:*')
    }
  })

  it('leaves npm-external dependencies exactly as the template declared them', () => {
    const names = workspacePackageNames(ROOT)
    const manifest = readJson(TEMPLATE) as { dependencies: Record<string, string> }

    const linked = dependenciesOf(linkToWorkspace(manifest, names))

    // `@theokit/sdk` and `@usetheo/ui` live in sibling repositories and are consumed from npm
    // (pnpm-workspace.yaml says so). Rewriting them to `workspace:*` would make the install fail
    // outright, which is a louder bug but still a bug.
    expect(linked['@theokit/sdk']).toBe(manifest.dependencies['@theokit/sdk'])
    expect(linked.react).toBe(manifest.dependencies.react)
  })

  it('does not mutate the manifest it was handed', () => {
    const manifest = readJson(TEMPLATE) as { dependencies: Record<string, string> }
    const before = JSON.stringify(manifest)

    linkToWorkspace(manifest, workspacePackageNames(ROOT))

    expect(JSON.stringify(manifest)).toBe(before)
  })
})

/**
 * `Manifest.dependencies` is optional because a package.json may genuinely omit it. Every manifest
 * these cases feed in declares one, so an absent map means the rewrite dropped it — which is a
 * failure worth naming rather than narrowing away with a non-null assertion.
 */
function dependenciesOf(manifest: Manifest): Record<string, string> {
  const deps = manifest.dependencies
  if (deps === undefined)
    throw new Error('linkToWorkspace dropped `dependencies` from the manifest')
  return deps
}
