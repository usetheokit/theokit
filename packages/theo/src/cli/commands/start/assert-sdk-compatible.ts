/**
 * M48 (ecosystem-integration-guarantee) T3.2 — boot-time SDK compatibility fail-fast.
 *
 * The agent runtime is `@theokit/sdk` (G2). Today a missing / mis-versioned SDK is invisible until
 * the FIRST agent request, where `sdk-adapter.ts` yields a lazy `SDK_NOT_INSTALLED` stream event.
 * This runs at `theokit start` boot instead: if the installed SDK is present but outside the
 * supported range it throws a typed error naming found-vs-required; if it is absent (a legitimately
 * api-only app — the SDK is an OPTIONAL peer) it stays silent unless the caller marks it required.
 *
 * CLI/adapter layer → `node:*` is allowed here (unlike `server/`). The version range check itself is
 * the pure `server/agent/sdk-compat.ts` helper (one source of truth with the contract-test drift guard).
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

import { SUPPORTED_SDK_RANGE, satisfiesSdkRange } from '../../../server/agent/sdk-compat.js'

/** Typed error surfaced at boot when the installed `@theokit/sdk` is incompatible or absent-but-required. */
export class SdkIncompatibleError extends Error {
  readonly code = 'SDK_INCOMPATIBLE' as const
  readonly found: string | undefined
  readonly required: string
  constructor(found: string | undefined, required: string) {
    super(
      found === undefined
        ? `@theokit/sdk is required but not installed — run: pnpm add @theokit/sdk@${required}`
        : `@theokit/sdk ${found} does not satisfy the required range ${required} — run: pnpm add @theokit/sdk@${required}`,
    )
    this.name = 'SdkIncompatibleError'
    this.found = found
    this.required = required
  }
}

/** Resolve the version of the ACTUALLY-installed `@theokit/sdk`, or `undefined` when absent. */
function defaultResolveSdkVersion(): string | undefined {
  try {
    const require = createRequire(import.meta.url)
    const pkgPath = require.resolve('@theokit/sdk/package.json')
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string }
    return typeof pkg.version === 'string' ? pkg.version : undefined
  } catch {
    return undefined
  }
}

/**
 * Fail fast at boot when the installed `@theokit/sdk` is incompatible.
 *
 * - present + in range  → returns (silent)
 * - present + out of range → throws {@link SdkIncompatibleError} (found + required)
 * - absent + `required !== true` → returns (api-only app; the request path still guards lazily)
 * - absent + `required === true` → throws {@link SdkIncompatibleError}
 *
 * `resolveVersion` is injectable for tests (DIP); production uses {@link defaultResolveSdkVersion}.
 */
export function assertSdkCompatible(opts?: {
  required?: boolean
  resolveVersion?: () => string | undefined
}): void {
  const version = (opts?.resolveVersion ?? defaultResolveSdkVersion)()
  if (version === undefined) {
    if (opts?.required === true) throw new SdkIncompatibleError(undefined, SUPPORTED_SDK_RANGE)
    return
  }
  if (!satisfiesSdkRange(version, SUPPORTED_SDK_RANGE)) {
    throw new SdkIncompatibleError(version, SUPPORTED_SDK_RANGE)
  }
}
