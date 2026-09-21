import { describe, expect, it } from 'vitest'

import { renderBunEntry } from '../../packages/theo/src/adapters/bun.js'
import { renderCloudflareWorkerEntry } from '../../packages/theo/src/adapters/cloudflare.js'
import { renderDenoEntry } from '../../packages/theo/src/adapters/deno-deploy.js'

/**
 * Pillar (a) of the wiring triad for B-185's plugin-runner fix.
 *
 * The unit test one directory over proves `deployedAgentsFragment` CAN bind the runner. It cannot
 * prove any adapter passes it, and a capability that is correct and unreachable is the failure mode
 * this repository has already paid for: `agent-memory/` sat published, correct and refused one
 * package over for three days, while the table that an author checks said `read`.
 *
 * So this renders each adapter's real entry and reads what came out.
 */
describe('a deploy target binds its plugin runner', () => {
  const AGENTS = [{ name: 'a', filePath: 'a.ts', agentPath: '/api/agents/a' }]

  const RENDERERS: readonly (readonly [string, (o: Record<string, unknown>) => string])[] = [
    [
      'cloudflare',
      (o) =>
        renderCloudflareWorkerEntry({
          agents: AGENTS,
          contextModule: 'server/context.js',
          ...o,
        } as Parameters<typeof renderCloudflareWorkerEntry>[0]),
    ],
    ['bun', (o) => renderBunEntry(3000, o as Parameters<typeof renderBunEntry>[1])],
    ['deno-deploy', (o) => renderDenoEntry(3000, o as Parameters<typeof renderDenoEntry>[1])],
  ]

  it('test_every_wired_adapter_hands_the_resolver_the_runner_it_built', () => {
    for (const [name, render] of RENDERERS) {
      const entry = render({ runtimeConfigModule: './theo.plugins.mjs' })

      // The entry declares the const once, at module load, and the subject resolver must read THAT
      // one. A runner rebuilt per request re-runs every plugin's `register`, which is where a
      // plugin allocates the state its hooks then read.
      expect(entry, `${name}: the entry never declares the runner`).toContain(
        'const THEO_PLUGIN_RUNNER',
      )
      expect(entry, `${name}: the subject resolver does not receive it`).toContain(
        'await THEO_PLUGIN_RUNNER',
      )
    }
  })

  it('test_an_app_with_no_plugins_emits_no_reference_to_a_const_it_never_declared', () => {
    // The negative half, and the one that makes the positive mean something. Binding
    // unconditionally would emit an identifier the entry does not declare, turning a missing
    // decoration into a ReferenceError at the first request -- strictly worse than the defect.
    for (const [name, render] of RENDERERS) {
      const entry = render({})
      expect(entry, `${name}: orphan reference to a const this entry never declares`).not.toContain(
        'THEO_PLUGIN_RUNNER',
      )
    }
  })
})
