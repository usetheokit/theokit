/**
 * TheoCloud deploy adapter — builds the application, validates the service manifest, hands over.
 *
 * Per ADR-0012 (mission expansion) + the 2026-06-05 owner architectural decision, TheoKit OSS does
 * NOT emit K8s manifests. That decision is unchanged and it is well argued: an OSS framework must
 * emit formats consumed by public or neutral systems, not a proprietary platform's internal shape.
 * K8s emission lives entirely inside TheoCloud, on receiving the upload.
 *
 * ## What the thinness did NOT cover, and did
 *
 * Until 2026-09-30 this adapter read `.theokit/services.json`, checked its version, logged, and
 * returned. Measured on a fresh `create-theokit` scaffold:
 *
 *     theokit build --target theo-cloud
 *       [theo-cloud] … Bundle ready for upload — …
 *       ✓ Build complete → theo-cloud
 *     ls .theokit
 *       crons.json  jobs.json  manifest.json  services.json
 *
 * Four manifests and no application: no client, no server entry, nothing a runtime could serve. And a
 * build empties its output first, so running this target DESTROYED whatever the previous one left and
 * reported a bundle in its place.
 *
 * Two of this repository's own documents state the contract it did not keep —
 * `docs/surfaces/build-adapters.md` ("validates a service manifest, logs the services and **hands over
 * a bundle**") and the capability matrix ("Validates `.theokit/services.json` and **prepares the
 * bundle**"). Declared twice, implemented nowhere.
 *
 * The argument for thinness is about the PLATFORM'S format. The application is not that: it is the
 * same client and server entry every other target builds, and `nodeAdapter` is what builds it — which
 * is what `vercel` already delegates to for the same half of the same problem.
 */
import type { TheoConfig } from '../config/schema.js'
import {
  prepareTheoCloudArtifacts,
  readManifest as readManifestFromDisk,
} from '../services/index.js'

import { nodeAdapter } from './node.js'
import type { AdapterBuildContext, DeployAdapter } from './types.js'

/** The seams this build reaches the world through, injectable so the decision is testable. */
export interface TheoCloudBuildDeps {
  /** Builds the application. Defaults to the node adapter, which is what produces one. */
  readonly runNodeBuild?: (
    config: TheoConfig,
    cwd: string,
    ctx?: AdapterBuildContext,
  ) => Promise<void>
  /** Reads `.theokit/services.json`. Defaults to the real reader. */
  readonly readManifest?: typeof readManifestFromDisk
}

/**
 * The build, with its seams injectable — the shape `buildVercel` already has in this directory.
 *
 * `DeployAdapter['build']` takes three parameters, so a fourth for the seams does not typecheck at the
 * call site. Exporting the function and having the method delegate is how the other adapters solved
 * the same problem, and it keeps the injection out of the interface every adapter implements.
 *
 * @param config the project's resolved config
 * @param cwd the project root
 * @param deps the seams, defaulted to the real ones
 * @param ctx the build context, forwarded to the node build unchanged
 */
export async function buildTheoCloud(
  config: TheoConfig,
  cwd: string,
  deps: TheoCloudBuildDeps = {},
  ctx?: AdapterBuildContext,
): Promise<void> {
  const runNodeBuild = deps.runNodeBuild ?? nodeAdapter.build.bind(nodeAdapter)
  const readManifest = deps.readManifest ?? readManifestFromDisk

  // The application first: without it there is nothing for the sentence below to be about.
  await runNodeBuild(config, cwd, ctx)

  const artifacts = prepareTheoCloudArtifacts(readManifest(cwd))
  const summary =
    artifacts.services.length === 0 ? 'TS-only app (no services)' : artifacts.services.join(', ')
  // `Wave 3 v2.0` and `TheoCloud emits K8s manifests internally` are ASSERTED invariants, each with
  // its reason stated in `tests/unit/theo-cloud-adapter-v2.test.ts` — the version tag and the
  // architectural mental model. Rewording them was scope this fix did not need, and it broke both.
  // What the fix adds is where the bundle is, so `ready for upload` is checkable.
  //
  // eslint-disable-next-line no-console -- CLI build progress
  console.log(
    `[theo-cloud] Wave 3 v2.0: manifest schemaVersion=${String(artifacts.manifestVersion)}, ` +
      `services=${summary}. Bundle ready for upload from ${config.distDir} — TheoCloud emits K8s ` +
      `manifests internally upon deploy.`,
  )
}

export const theoCloudAdapter: DeployAdapter = {
  name: 'theo-cloud',
  // #382 — this adapter emits no request handler of its own; TheoCloud's runtime serves the bundle.
  streamsResponses: false,
  // This adapter emits no request handler -- TheoCloud's proprietary runtime
  // serves the bundle. What that runtime applies is not knowable from here, and
  // reporting the config as dropped would be asserting rather than measuring.
  appliesConfig: 'runtime-not-emitted-here',
  // B-257 — emits no request handler; this build cannot answer for that runtime.
  enforcesRateLimit: 'not-ours-to-judge',

  build(config: TheoConfig, cwd: string, ctx?: AdapterBuildContext): Promise<void> {
    return buildTheoCloud(config, cwd, {}, ctx)
  },
}
