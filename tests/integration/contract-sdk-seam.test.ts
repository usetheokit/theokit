/**
 * M48 (ecosystem-integration-guarantee) T2.1 + T2.2 — the CONSUMER contract test for the
 * `theokit ↔ @theokit/sdk` seam. Mirrors the theo-ui seam recipe
 * (`contract-usetheo-ui-vite-plugin.test.ts`): exercise the REAL installed SDK (no mocks) and pin
 * exactly the surface theokit binds, so a future SDK release that renames/removes a consumed symbol
 * fails HERE, in CI, instead of silently at an app's first agent request.
 *
 * Replaces the stale `sdk-1-1-0-exports.test.ts` (hardcoded `major===3` + imported the
 * conversation-storage classes SDK 4.0 removed).
 *
 * EC-C: the SDK is resolved CONSUMER-SCOPED from `packages/theo` — the version the framework runs
 * on — never the ambient root hoist. This is the exact fixture-scoped resolution theo-ui uses.
 */
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { satisfiesSdkRange } from '../../packages/theo/src/server/agent/sdk-compat.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const CONSUMER_PKG = join(ROOT, 'packages', 'theo', 'package.json')
const consumerRequire = createRequire(pathToFileURL(CONSUMER_PKG).href)

// Resolve the SDK the FRAMEWORK uses (packages/theo → 4.0.x), NOT the root hoist.
let sdkPresent = true
let sdkEntry = ''
let sdkVersion = ''
try {
  sdkEntry = consumerRequire.resolve('@theokit/sdk')
  const pkg = JSON.parse(
    readFileSync(consumerRequire.resolve('@theokit/sdk/package.json'), 'utf8'),
  ) as { version: string }
  sdkVersion = pkg.version
} catch {
  sdkPresent = false
}

describe.skipIf(!sdkPresent)('contract: @theokit/sdk seam surface theokit binds (M48 T2.1)', () => {
  it('test_sdk_exports_Agent_with_getOrCreate_and_registry', async () => {
    const sdk = await import(pathToFileURL(sdkEntry).href)
    expect(typeof sdk.Agent).toBe('function')
    expect(typeof sdk.Agent.getOrCreate).toBe('function') // sdk-adapter.ts:635
    expect(typeof sdk.Agent.registry).toBe('object') // bootstrap-stages.ts / graceful-shutdown.ts
    expect(typeof sdk.Agent.registry.configure).toBe('function')
    expect(typeof sdk.Agent.registry.evictAll).toBe('function')
  })

  it('test_sdk_Tool_create_produces_a_CustomTool_shape', async () => {
    const sdk = await import(pathToFileURL(sdkEntry).href)
    expect(typeof sdk.Tool.create).toBe('function') // sdk-adapter.ts:208,457
    // `Tool.create`'s spec takes a ZOD `inputSchema` (define-tool.d.ts:24) — the exact shape
    // theokit's buildSdkTools passes (sdk-adapter.ts:459) — and returns a `CustomTool`.
    const tool = sdk.Tool.create({
      name: 'contract_probe',
      description: 'probe',
      inputSchema: z.object({ q: z.string() }),
      handler: () => 'ok',
    })
    expect(tool).toMatchObject({ name: 'contract_probe', description: 'probe' })
    expect(typeof tool.handler).toBe('function')
    expect(tool.inputSchema, 'Tool.create returns a JSON-Schema inputSchema').toBeTypeOf('object')
  })

  it('test_sdk_exports_typed_error_bases', async () => {
    const sdk = await import(pathToFileURL(sdkEntry).href)
    expect(typeof sdk.AgentRunError).toBe('function') // typed-error cause chain
    expect(typeof sdk.TheokitAgentError).toBe('function')
    expect(typeof sdk.ToolError).toBe('function')
  })

  it('test_sdk_exports_SkillReadTool_create (theokit guards its presence with `in`)', async () => {
    const sdk = await import(pathToFileURL(sdkEntry).href)
    // theokit degrades gracefully if absent (sdk-adapter.ts:203) — but on 4.0.x it IS present.
    expect(typeof sdk.SkillReadTool?.create).toBe('function')
  })

  // T2.2 — version-drift guard (EC-7 analog). The version the FRAMEWORK resolves MUST satisfy the
  // range packages/theo declares. Would have caught the live `^4.0.1`-floor / `3.5.0`-hoist drift.
  it('test_resolved_sdk_version_satisfies_the_declared_peer_range', () => {
    const consumerPkg = JSON.parse(readFileSync(CONSUMER_PKG, 'utf8')) as {
      peerDependencies: Record<string, string>
    }
    const declared = consumerPkg.peerDependencies['@theokit/sdk']
    expect(declared, 'packages/theo must declare an @theokit/sdk peer range').toBeTruthy()
    expect(
      satisfiesSdkRange(sdkVersion, declared),
      `resolved @theokit/sdk@${sdkVersion} does not satisfy packages/theo peer range ${declared}`,
    ).toBe(true)
  })
})
