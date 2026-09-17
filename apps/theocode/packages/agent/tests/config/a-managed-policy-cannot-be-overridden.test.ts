import { describe, expect, it } from 'vitest'

import { resolveConfig } from '../../src/config/config.js'

/**
 * #737 — an enterprise `managed-settings.json` outranks every user-editable layer.
 *
 * The reference defines it as settings a user CANNOT override, with its own tier above everything
 * else. This product read no such file, so an organisation deploying a policy — a forced model, a
 * denied tool, a required hook — had it silently dropped while the same policy held in the tool it was
 * written for. The failure direction is PERMIT, which is why this is an ignored control rather than a
 * missing feature.
 *
 * `cli` is included in the assertions deliberately. It is the operator's own override and it wins over
 * every file in this product's layering — and it must NOT win here, because the whole point of a
 * managed policy is that the person at the keyboard is the one it binds.
 */
describe('a managed policy', () => {
  it('test_a_project_setting_cannot_override_it', () => {
    const resolved = resolveConfig({
      managed: { model: 'managed/forced-model' },
      project: { model: 'project/preferred-model' },
    })

    expect(resolved.model, 'a repository overrode the organisation policy').toBe(
      'managed/forced-model',
    )
  })

  it('test_a_cli_flag_cannot_override_it_either', () => {
    const resolved = resolveConfig({
      managed: { model: 'managed/forced-model' },
      cli: { model: 'cli/whatever-i-typed' },
    })

    expect(resolved.model, 'the operator overrode the organisation policy').toBe(
      'managed/forced-model',
    )
  })

  it('test_without_one_nothing_changes', () => {
    // The control: a machine with no managed file must resolve exactly as it did before, or this tier
    // would quietly become a new source of defaults.
    const resolved = resolveConfig({ project: { model: 'project/preferred-model' } })

    expect(resolved.model).toBe('project/preferred-model')
  })
})
