import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { renderAwsLambdaEntry } from '../../packages/theo/src/adapters/aws-lambda.js'
import { renderBunEntry } from '../../packages/theo/src/adapters/bun.js'
import { renderCloudflareWorkerEntry } from '../../packages/theo/src/adapters/cloudflare.js'
import { findUnappliedConfig } from '../../packages/theo/src/adapters/config-support.js'
import { renderDenoEntry } from '../../packages/theo/src/adapters/deno-deploy.js'
import {
  mergeNetlifyToml,
  renderNetlifyFunction,
} from '../../packages/theo/src/adapters/netlify.js'
import { nodeAdapter } from '../../packages/theo/src/adapters/node.js'
import { resolveAdapter } from '../../packages/theo/src/adapters/registry.js'
import {
  renderVercelConfigJson,
  renderVercelFunctionEntry,
} from '../../packages/theo/src/adapters/vercel.js'
import type { TheoConfig } from '../../packages/theo/src/config/schema.js'
import { BUILD_HOOK_TIMEOUT_MS, buildTheokitPackageOnce } from './_helpers/build-theokit-package.js'
import { type DeployTarget, loadDeployedEntry } from './_helpers/drive-deployed-entry.js'

/**
 * usetheokit/theokit#1097 — `theokit start` answers `/__theo/health` and `/__theo/ready` (with the
 * `ready` probe from `theo.config.ts`). The six Web targets answered neither: both paths fell
 * through to the SPA document, so a health check read `200 text/html` as ready, and a declared
 * probe was dropped without the build saying so.
 *
 * Driven, not grepped: each emitted entry is loaded and handed the request its platform would
 * send (`_helpers/drive-deployed-entry.ts`).
 */

interface RenderOptions {
  readyProbeDeclared?: boolean
}

const ENTRIES: readonly (readonly [DeployTarget, (o: RenderOptions) => string])[] = [
  ['cloudflare', (o) => renderCloudflareWorkerEntry({ ssrStreaming: false, ...o })],
  ['bun', (o) => renderBunEntry(3000, o)],
  ['deno-deploy', (o) => renderDenoEntry(3000, o)],
  ['vercel', (o) => renderVercelFunctionEntry(o)],
  ['netlify', (o) => renderNetlifyFunction(o)],
  ['aws-lambda', (o) => renderAwsLambdaEntry(o)],
]

let workspace: string

describe('every deployed entry answers the reserved routes', () => {
  beforeAll(() => {
    buildTheokitPackageOnce()
    workspace = mkdtempSync(join(tmpdir(), 'theo-reserved-'))
  }, BUILD_HOOK_TIMEOUT_MS)

  afterAll(() => {
    if (workspace !== undefined) rmSync(workspace, { recursive: true, force: true })
  })

  for (const [target, render] of ENTRIES) {
    describe(target, () => {
      it('answers /__theo/health with the liveness envelope', async () => {
        const drive = await loadDeployedEntry(target, render({}), workspace)
        const health = await drive({ path: '/__theo/health' })
        expect(health.status, health.body).toBe(200)
        expect(health.contentType).toContain('application/json')
        expect(JSON.parse(health.body)).toEqual({ status: 'ok' })
      })

      it('answers /__theo/ready as ready when the config declares no probe', async () => {
        const drive = await loadDeployedEntry(target, render({}), workspace)
        const ready = await drive({ path: '/__theo/ready' })
        expect(ready.status, ready.body).toBe(200)
        expect(JSON.parse(ready.body)).toEqual({ status: 'ready' })
      })

      it('fails /__theo/ready closed when the config declares a probe it cannot carry', async () => {
        const drive = await loadDeployedEntry(
          target,
          render({ readyProbeDeclared: true }),
          workspace,
        )
        const ready = await drive({ path: '/__theo/ready' })
        expect(ready.status, ready.body).toBe(503)
        expect(JSON.parse(ready.body)).toEqual({ status: 'not-ready' })
      })
    })
  }

  it('sends the reserved paths to the Vercel function rather than the static host', () => {
    const { routes } = renderVercelConfigJson()
    const filesystem = routes.findIndex((r) => 'handle' in r && r.handle === 'filesystem')
    // The first rule that both matches and routes somewhere decides; a header rule only continues.
    const reserved = routes.findIndex(
      (r) =>
        'dest' in r &&
        r.dest !== undefined &&
        new RegExp(`^${String((r as { src?: string }).src)}$`).test('/__theo/ready'),
    )
    expect(reserved, JSON.stringify(routes)).toBeGreaterThanOrEqual(0)
    expect(reserved).toBeLessThan(filesystem)
    expect((routes[reserved] as { dest?: string }).dest).toBe('/api')
  })

  it('sends the reserved paths to the Netlify function ahead of the SPA fallback', () => {
    for (const existing of [null, '[[redirects]]\n  from = "/*"\n  to = "/index.html"\n']) {
      const toml = mergeNetlifyToml(existing)
      const reserved = toml.indexOf('from = "/__theo/*"')
      expect(reserved, toml).toBeGreaterThanOrEqual(0)
      expect(reserved).toBeLessThan(toml.indexOf('from = "/*"'))
      expect(toml.slice(reserved)).toMatch(
        /^from = "\/__theo\/\*"\s+to = "\/.netlify\/functions\/theo"/,
      )
    }
  })

  it('names a declared ready probe as not applied on every target but node', async () => {
    const config = { ready: () => true } as unknown as TheoConfig
    expect(findUnappliedConfig(config, nodeAdapter)).not.toContain('ready')
    for (const [target] of ENTRIES) {
      expect(findUnappliedConfig(config, await resolveAdapter(target)), target).toContain('ready')
    }
  })
})
