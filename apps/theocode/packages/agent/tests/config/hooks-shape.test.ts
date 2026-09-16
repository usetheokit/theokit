/**
 * #144 — a flat `hooks` array in a `settings.json` refuses every turn, and the refusal was the SDK's.
 *
 * `.theokit/` is `@theokit/agents`' filebase, so its own settings loader reads
 * `.theokit/settings.json` and validates `hooks` against ITS shape — Claude Code's nested-by-event
 * object. Our flat array fails that validation and the failure is fatal to the turn.
 *
 * Measured with three arms: the flat array refused every turn; the same file without `hooks` reached
 * the model; the same file with the nested dialect reached the model. Only our own documented shape
 * failed, which is why nothing here caught it — our parser accepts the flat array, and it is the
 * SDK's independent read of the same file that fails.
 *
 * This did not exist before v0.11.0: the file was `config.toml`, and the SDK does not read TOML.
 * Renaming our configuration to `settings.json` put it inside a filename another loader already owns.
 *
 * So the flat array is refused HERE, with the nested form spelled out. A refusal that names the fix
 * beats a fatal error that names a validator — and it arrives first, which is the whole point.
 */
import { describe, expect, it } from 'vitest'

import { CONFIG_SCHEMA_KEYS } from '../../src/config/config-contract.js'
import { translateSettings } from '../../src/config/settings-json.js'

const OURS = { ownKeys: CONFIG_SCHEMA_KEYS, foreignRoot: false, hooksDelivery: 'ours' } as const

describe('the hooks shape a settings.json may carry', () => {
  it('test_a_flat_array_is_refused_by_name', () => {
    expect(() => translateSettings({ hooks: [{ event: 'Stop', command: 'x' }] }, OURS)).toThrow(
      /hooks/,
    )
  })

  it('test_the_refusal_shows_the_shape_that_works', () => {
    // Naming the defect without naming the fix would leave the operator exactly where the SDK's
    // error left them, one layer earlier.
    let said = ''
    try {
      translateSettings({ hooks: [{ event: 'Stop', command: 'x' }] }, OURS)
    } catch (err) {
      said = (err as Error).message
    }
    expect(said).toContain('"Stop"')
    expect(said).toContain('type')
    expect(said).toContain('command')
  })

  it('test_the_nested_dialect_is_accepted', () => {
    // The positive control, and the shape both readers accept.
    const read = translateSettings(
      { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'x' }] }] } },
      OURS,
    )
    expect(read.values['hooks']).toEqual([{ event: 'Stop', command: 'x' }])
  })

  it('test_a_file_with_no_hooks_is_untouched', () => {
    // Anti-vacuity floor: a translator that threw on everything would satisfy the first two arms.
    expect(translateSettings({ model: 'openai/x' }, OURS).values).toEqual({ model: 'openai/x' })
  })

  it('test_a_foreign_root_never_refuses_and_never_keeps', () => {
    // Under `.claude/` the hooks are not this product's to police: any shape is dropped and
    // REPORTED, never refused. Refusing there would fail a file this product does not own, over a
    // key it does not run.
    //
    // The comment used to say they "belong to the loader that already runs them (#130)". Measured
    // 2026-09-12, nothing runs them: `hooks` is absent from `FOREIGN_SURFACES`, so the SDK never
    // lists `.claude/` among its hook candidates. The conclusion — do not police the shape — is
    // unchanged; the reason was wrong.
    const read = translateSettings({ hooks: [{ event: 'Stop', command: 'x' }] }, {
      ownKeys: CONFIG_SCHEMA_KEYS,
      foreignRoot: true,
      hooksDelivery: 'sdk',
    })

    expect(read.values['hooks']).toBeUndefined()
    expect(read.droppedHooks.join(' ')).toContain('nothing runs')
  })
})
