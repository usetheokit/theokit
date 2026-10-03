import type { BuildTarget } from '../../../adapters/types.js'
import type { ServicesManifest } from '../../../services/index.js'

/**
 * The build line about `.theokit/services.json`, or `null` when there is nothing worth saying.
 *
 * The v1 warning is addressed to `theo-cloud`, the one target that reads the file. It used to print
 * on every target, for apps that declare no services, and it named a sunset in `theokit 0.6.0` that
 * had passed 68 minors earlier without anything being removed. A deadline nobody enforces teaches
 * the reader to skip the line, so the warning states what the file is and how to upgrade it.
 */
export function describeServicesManifest(
  manifest: ServicesManifest,
  target: BuildTarget,
): string | null {
  if (manifest.services.length > 0) {
    const projectLabel = manifest.version === 2 ? ` project="${manifest.project}"` : ''
    const names = manifest.services.map((s) => s.name).join(', ')
    return (
      `✓ Services manifest (v${String(manifest.version)}${projectLabel}): ` +
      `${String(manifest.services.length)} service(s) (${names})`
    )
  }
  if (manifest.version === 1 && target === 'theo-cloud') {
    return (
      '⚠ services.json emitted as v1 (no `name` in theo.config.ts), which TheoCloud reads as ' +
      'deprecated. Run `theokit migrate services-json-v1-to-v2` to upgrade.'
    )
  }
  return null
}
