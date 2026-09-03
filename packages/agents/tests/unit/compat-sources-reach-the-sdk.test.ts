import { describe, expect, it } from 'vitest'

import { assembleM8CreateOptions } from '../../src/bridge/sdk-adapter-create-options.js'

/**
 * usetheokit/theokit#634 — the forward, and the reason it was blocked until measured otherwise.
 *
 * The argument for waiting was that a forward written against an SDK that ignores the key would be
 * SILENTLY inert: the consumer declares the opt-in, passes this layer's gate, and gets nothing. The
 * silence is the defect, not the inertness — and the silence is removable from here, because
 * `@theokit/sdk` declares `"./package.json"` in `exports`, so its version is readable at runtime.
 *
 * Measured on the published artefact: `require('@theokit/sdk/package.json').version` → `5.0.0-next.1`.
 *
 * So the forward ships without raising the floor. On an SDK that knows the key it works; on one that
 * does not, the warning comes from HERE — which is the half where `theokit-sdk#526` cannot help,
 * because that fix only exists in the SDK that already supports the option.
 */
describe('compatSources reaches Agent.create', () => {
  it('lands on `local.compatSources`, which is where the SDK reads it', () => {
    const { options } = assembleM8CreateOptions({
      name: 'a',
      model: 'openai/gpt-4o-mini',
      compatSources: ['claude-code'],
    } as never)

    expect((options as { local?: { compatSources?: string[] } }).local?.compatSources).toEqual([
      'claude-code',
    ])
  })

  it('does not invent the key when nothing was declared', () => {
    // Omitting is not enabling — the same asymmetry the gate above is built on. An empty array
    // would read as a decision and would make the SDK's own default unreachable from this layer.
    //
    // This assertion passed while the forward was still absent, because `undefined?.compatSources`
    // is `undefined` too. It is only meaningful beside the positive case above, which is why the
    // two travel together.
    const { options } = assembleM8CreateOptions({
      name: 'a',
      model: 'openai/gpt-4o-mini',
    } as never)

    expect(
      (options as { local?: { compatSources?: string[] } }).local?.compatSources,
    ).toBeUndefined()
  })

  it('does not clobber `settingSources` when both are declared', () => {
    // Both project onto `local`, and the second spread eating the first is the ordinary way this
    // breaks — invisibly, because each one passes its own test.
    const { options } = assembleM8CreateOptions({
      name: 'a',
      model: 'openai/gpt-4o-mini',
      settingSources: ['project'],
      compatSources: ['claude-code'],
    } as never)

    const local = (options as { local?: { settingSources?: string[]; compatSources?: string[] } })
      .local
    expect(local?.settingSources).toEqual(['project'])
    expect(local?.compatSources).toEqual(['claude-code'])
  })
})
