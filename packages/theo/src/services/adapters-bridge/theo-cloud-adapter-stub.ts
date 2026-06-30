/**
 * TheoCloud adapter scaffolding (T3.5 — Wave 2 stub; full Wave 3).
 *
 * Wave 2 establishes the contract: the adapter CONSUMES `.theokit/services.json`
 * (manifest emitted by `theokit build`) and produces TheoCloud deployment
 * artifacts. The artifacts themselves (K8s manifests, Helm charts, etc.) are
 * Wave 3 deliverables — this module provides the read/validate gate so the
 * manifest format is locked NOW.
 *
 * Per ADR-0012 invariant #4, the same `.theokit/services.json` consumed by
 * the `node` adapter (docker-compose generator) is the same shape consumed
 * here. No platform-specific fields. The contract is global.
 */
import type { ServicesManifest } from './manifest.js'

export interface TheoCloudAdapterArtifacts {
  /** Manifest schemaVersion the adapter consumed (v1 deprecated, v2 current). */
  manifestVersion: 1 | 2
  /** Service names that will be deployed. */
  services: string[]
  /** Wave 3 will populate K8s manifests here. */
  k8sManifests?: never
  /** Wave 3 will populate Helm values here. */
  helmValues?: never
}

/**
 * Wave 2 stub — validates the manifest is consumable. Throws if shape is
 * unexpected (forward-compat guard for Wave 3 development).
 *
 * Wave 3 will replace the body with real K8s manifest emission.
 */
export function prepareTheoCloudArtifacts(
  manifest: ServicesManifest | null,
): TheoCloudAdapterArtifacts {
  if (manifest === null) {
    return { manifestVersion: 1, services: [] }
  }
  // v1 (deprecated, sunset 0.6.0) and v2 (current, adds `project`) share the
  // same `services[]` shape the adapter consumes — both are accepted. Any
  // other version is a forward-compat guard: bump handling here before the
  // builder emits a newer schema. (Regression: usetheodev/theokit#9 — the
  // builder emits v2 when a project name is supplied; rejecting v2 broke
  // every `theokit build --target theo-cloud`.)
  //
  // The type says `1 | 2`, but the manifest is read from disk (`readManifest`)
  // so a malformed/newer file can carry any number at runtime — read through a
  // numeric local so the guard stays reachable (narrowing `manifest.version`
  // directly would collapse the guard body to `never`).
  const version: number = manifest.version
  if (version !== 1 && version !== 2) {
    throw new Error(
      `TheoCloud adapter: unsupported manifest version ${String(version)}. ` +
        `Supported: schemaVersion 1 (deprecated) or 2. Update the adapter before bumping.`,
    )
  }
  return {
    manifestVersion: manifest.version,
    services: manifest.services.map((s) => s.name),
  }
}
