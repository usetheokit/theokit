/**
 * The bundle `theo-cloud` says is ready, and did not build.
 *
 * `theoCloudAdapter.build` read `.theokit/services.json`, checked its version, logged, and returned.
 * Then it printed `Bundle ready for upload — TheoCloud emits K8s manifests internally upon deploy.`
 *
 * Measured 2026-09-30 on a fresh `create-theokit` scaffold, running the target from the installed CLI:
 *
 *     theokit build --target theo-cloud
 *       [theo-cloud] … Bundle ready for upload — …
 *       ✓ Build complete → theo-cloud
 *     ls .theokit
 *       crons.json  jobs.json  manifest.json  services.json
 *
 * Four manifests and no application. No client, no server entry, nothing a runtime could serve. And
 * because a build empties its output directory first, running this target DESTROYS whatever the
 * previous build left and reports a bundle in its place.
 *
 * `prepareTheoCloudArtifacts` lives in `theo-cloud-adapter-stub.ts` and returns
 * `{ manifestVersion, services }` — the manifest's version and the service names. It prepares nothing.
 *
 * ## Why this is a defect and not the documented design
 *
 * The thinness IS the design, and it is well argued: `docs/surfaces/build-adapters.md` and the
 * capability matrix both say TheoKit must not emit a proprietary platform's orchestration format. That
 * argument covers the K8s manifests. It does not cover the application, and both documents say the
 * adapter hands one over:
 *
 *     "The managed adapter validates a service manifest, logs the services and hands over a bundle"
 *     "Validates `.theokit/services.json` and prepares the bundle"
 *
 * So the contract is declared in two places and implemented in none. The fix is the one every other
 * target already uses for the application half: delegate to the node build, which is what produces a
 * client and a server entry, and leave the platform's own format to the platform.
 */
import { describe, expect, it, vi } from 'vitest'

import { buildTheoCloud } from '../../packages/theo/src/adapters/theo-cloud.js'
import type { TheoConfig } from '../../packages/theo/src/config/schema.js'

const CONFIG = {
  serverDir: 'src/server',
  appDir: 'src/app',
  distDir: '.theokit',
  ssr: false,
  ssrStreaming: false,
  security: {},
} as unknown as TheoConfig

describe('the managed target hands over something', () => {
  it('builds the application before saying a bundle is ready', async () => {
    // THE case. Without this the target emits four manifests and reports a bundle.
    const runNodeBuild = vi.fn(async () => {})

    await buildTheoCloud(CONFIG, '/nowhere', { runNodeBuild })

    expect(
      runNodeBuild,
      'nothing built the application, so `Bundle ready for upload` names an artifact that does not exist',
    ).toHaveBeenCalledOnce()
  })

  it('passes the project root and the config through unchanged', async () => {
    // COUNTERPROOF for the call above: calling it with the wrong cwd builds somewhere else, which
    // reads as success and leaves the project exactly as empty.
    const runNodeBuild = vi.fn(async () => {})

    await buildTheoCloud(CONFIG, '/some/project', { runNodeBuild })

    expect(runNodeBuild).toHaveBeenCalledWith(CONFIG, '/some/project', undefined)
  })

  it('still validates the services manifest', async () => {
    // The thin validation IS the documented design and must survive the fix. An unsupported manifest
    // version has to keep failing the build rather than being built past.
    const runNodeBuild = vi.fn(async () => {})

    await expect(
      buildTheoCloud(CONFIG, '/nowhere', {
        runNodeBuild,
        readManifest: () => ({ version: 99, services: [] }) as never,
      }),
    ).rejects.toThrow(/unsupported manifest version 99/i)
  })

  it('builds before it validates nothing — order is not asserted, presence is', async () => {
    // Deliberately NOT asserting call order: which comes first is not a property anyone consumes, and
    // pinning it would make an ordinary refactor fail. What matters is that both happen.
    const calls: string[] = []

    await buildTheoCloud(CONFIG, '/nowhere', {
      runNodeBuild: async () => {
        calls.push('build')
      },
      readManifest: () => {
        calls.push('validate')
        return null
      },
    })

    expect(calls).toContain('build')
    expect(calls).toContain('validate')
  })
})
