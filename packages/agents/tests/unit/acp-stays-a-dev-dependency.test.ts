/**
 * B-414 — `@theokit/acp` is a dev dependency of `@theokit/agents`, and nothing it ships reaches it.
 *
 * The package serves an agent over ACP in a test only: `tests/integration/an-agent-is-served-over-
 * acp.test.ts` drives the published server. A consumer of `@theokit/agents` must not install the
 * server, so the key lives in `devDependencies` and in no section a consumer resolves, and no source
 * file imports or re-exports it.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const PACKAGE_ROOT = join(import.meta.dirname, '..', '..')
const ACP = '@theokit/acp'

interface PackageManifest {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return entry.name.endsWith('.ts') ? [path] : []
  })
}

describe('@theokit/acp stays a dev dependency', () => {
  it('test_acp_is_in_devDependencies_and_in_no_other_dependency_section', () => {
    const manifest = JSON.parse(
      readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'),
    ) as PackageManifest

    expect(manifest.devDependencies?.[ACP], 'the ACP test has no server to drive').toBeDefined()
    expect(manifest.dependencies?.[ACP]).toBeUndefined()
    expect(manifest.peerDependencies?.[ACP]).toBeUndefined()
    expect(manifest.optionalDependencies?.[ACP]).toBeUndefined()
  })

  it('test_no_source_file_mentions_acp', () => {
    const mentions = sourceFiles(join(PACKAGE_ROOT, 'src')).filter((file) =>
      readFileSync(file, 'utf8').includes(ACP),
    )

    expect(mentions, 'a consumer would install the server to load these').toEqual([])
  })
})
