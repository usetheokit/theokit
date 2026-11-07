import { describe, expect, it } from 'vitest'

import {
  resolveCompatSources,
  resolveSettingSources,
} from '../../src/bridge/setting-sources-gate.js'
import type { SettingSourcesSelection } from '../../src/bridge/setting-sources-gate.js'
import {
  assembleM8CreateOptions,
  compatSourcesForSdk,
} from '../../src/bridge/sdk-adapter-create-options.js'
import type { CompiledAgentOptions } from '../../src/bridge/agent-compiler.js'

/**
 * B-004, seventh review round — a refusal that was documented and did not exist.
 *
 * `claudeCode.import` narrows WHICH surfaces of a foreign configuration root to read. Its docblock
 * said the narrowed form is "refused at resolve time" on an SDK older than 5.4.0. Nothing read a
 * version for it: the only two version checks in this layer are the hook gate (5.4.0, a different
 * option) and a compat-sources WARNING that returns silently for any major >= 5.
 *
 * So on 5.0.0 <= SDK < 5.4.0 — squarely inside this package's declared `^4.52.1 || ^5.0.0` — a
 * narrowed `import` was forwarded, dropped by the runtime in silence, and the foreign root was not
 * read AT ALL. A consumer asking for "the skills but not the hooks" got nothing, which is further
 * from what they asked for than the un-narrowed form would have been.
 *
 * `compatSources` itself landed in 5.0.0 and the NARROWED shape in 5.4.0. Treating those two
 * versions as one is the whole defect.
 */
/**
 * Compat sources are BRANDED, and the brand is mintable only by `resolveCompatSources`. These
 * fixtures therefore go through the real resolver instead of hand-building the value — which the
 * type now refuses, and which is the point: the field claimed "a value here can only hold a source
 * some posture granted" while a raw array reached it cast-free.
 *
 * Going through the resolver is also the stronger test. The narrowing these cases exercise is
 * produced by the same function production calls, so a change to its output shape fails here rather
 * than passing against a fixture nobody kept in step.
 */
const trusted = (
  surfaces?: readonly string[],
): NonNullable<SettingSourcesSelection['claudeCode']> =>
  ({
    trustedBy: { level: 'trusted', source: 'test', allows: { projectSettings: true } },
    ...(surfaces === undefined ? {} : { import: surfaces }),
  }) as unknown as NonNullable<SettingSourcesSelection['claudeCode']>

const compatFor = (surfaces?: readonly string[]) =>
  resolveCompatSources({ claudeCode: trusted(surfaces) })

describe('resolveSettingSources reads the declaration, not merely its presence', () => {
  it('test_user_false_is_a_refusal_not_a_declaration', () => {
    // Found unpinned by the seventh review: mutating `selection.user === true` to
    // `!== undefined` left every setting-sources test green. Two docblocks assert that omitting is
    // not enabling and that `false` means "did not turn it on"; nothing measured it.
    expect(resolveSettingSources({ user: false })).toEqual([])
    expect(resolveSettingSources({ user: true })).toEqual(['user'])
    expect(resolveSettingSources({})).toEqual([])
  })
})

describe('the SDK is asked only for the surfaces the SDK handles', () => {
  // Tested through the pure projection AND through `assembleM8CreateOptions` below.
  //
  // This comment used to say the assembled path "cannot reach this code at all", because the version
  // gate ran first. That was true for one commit and the reorder that fixed it made it false — and
  // the sentence stayed, which is how the reorder shipped with no test through the path it changed.

  it('test_commands_is_subtracted_because_the_sdk_does_not_read_it', () => {
    // The two vocabularies diverge by one name on purpose: `commands` is this layer's, because
    // `.claude/commands/*.md` is read by `config/custom-commands.ts` and never by the SDK.
    expect(compatSourcesForSdk([{ kind: 'claude-code', import: ['commands', 'skills'] }])).toEqual([
      { kind: 'claude-code', import: ['skills'] },
    ])
  })

  it('test_a_source_the_sdk_cannot_use_is_dropped_rather_than_sent_empty', () => {
    // `resolveCompatSources` REFUSES `import: []` because "none" and "unset, so all of them" are
    // both defensible and differ by whether `.claude/hooks.json` executes. Forwarding
    // `import: ['commands']` reproduced that exact ambiguity one layer down, in silence: the SDK
    // received a list with zero names it defines. The source is dropped instead.
    expect(compatSourcesForSdk([{ kind: 'claude-code', import: ['commands'] }])).toEqual([])
  })

  it('test_the_whole_root_is_forwarded_unchanged', () => {
    expect(compatSourcesForSdk(['claude-code'])).toEqual(['claude-code'])
  })
})

describe('the gate reads what would actually be sent, not what was declared', () => {
  const base: CompiledAgentOptions = { model: 'm', tools: [], agents: {}, stream: true }

  it('test_a_narrowing_the_sdk_never_receives_is_not_refused', () => {
    // The reorder, pinned through the path it changed. `commands` is this layer's surface, so
    // `import: ['commands']` forwards NOTHING — and the version gate ran first anyway, telling an
    // operator on the declared floor (4.52.1) to upgrade for a narrowing that would never travel,
    // and denying `config/custom-commands.ts` the only surface it reads.
    //
    // Reverting the order leaves this test failing and every other one green: the fix had no test
    // at all, which is the same defect this file's sibling reports fixing one commit earlier.
    const { options } = assembleM8CreateOptions({
      ...base,
      compatSources: compatFor(['commands']),
    })

    expect(options.local?.compatSources, 'nothing the SDK handles remains').toBeUndefined()
  })

  it('test_a_narrowing_the_sdk_handles_is_forwarded', () => {
    // The control the refusal above was missing, and without which it proves nothing: a gate that
    // refused unconditionally would satisfy the assertion above and break every consumer. Naming
    // both versions is what makes the pair a statement about the boundary rather than about a
    // machine.
    const { options } = assembleM8CreateOptions({ ...base, compatSources: compatFor(['skills']) })

    expect(options.local?.compatSources).toEqual([{ kind: 'claude-code', import: ['skills'] }])
  })

  it('test_the_whole_root_needs_no_narrowing_and_is_forwarded', () => {
    const { options } = assembleM8CreateOptions({ ...base, compatSources: compatFor() })
    expect(options.local?.compatSources).toEqual(['claude-code'])
  })
})
