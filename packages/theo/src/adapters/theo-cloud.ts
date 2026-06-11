/**
 * TheoCloud deploy adapter (Wave 3 v2.0 thin validator).
 *
 * Per ADR-0012 (mission expansion) + 2026-06-05 owner architectural decision,
 * TheoKit OSS does NOT emit K8s manifests. This adapter is intentionally thin:
 *   1. Validates the `.theo/services.json` manifest shape (existing zod gate)
 *   2. Logs the services that will be deployed (visibility)
 *   3. Returns — bundle is ready for upload
 *
 * K8s manifest emission lives ENTIRELY inside TheoCloud (proprietary Go code)
 * upon receiving the upload. Rationale: OSS framework MUST emit formats
 * consumed by public/open systems OR neutral exchange formats; NÃO formats
 * consumed by proprietary closed systems. Exposing K8s shape here would leak
 * TheoCloud-internal infrastructure choices into the OSS surface.
 */
import type { TheoConfig } from '../config/schema.js'
import { prepareTheoCloudArtifacts, readManifest } from '../services/index.js'

import type { DeployAdapter } from './types.js'

export const theoCloudAdapter: DeployAdapter = {
  name: 'theo-cloud',

  build(_config: TheoConfig, cwd: string): Promise<void> {
    const manifest = readManifest(cwd)
    const artifacts = prepareTheoCloudArtifacts(manifest)
    const summary =
      artifacts.services.length === 0 ? 'TS-only app (no services)' : artifacts.services.join(', ')
    // eslint-disable-next-line no-console -- CLI build progress
    console.log(
      `[theo-cloud] Wave 3 v2.0: manifest schemaVersion=${String(artifacts.manifestVersion)}, ` +
        `services=${summary}. Bundle ready for upload — TheoCloud emits K8s manifests internally upon deploy.`,
    )
    return Promise.resolve()
  },
}
