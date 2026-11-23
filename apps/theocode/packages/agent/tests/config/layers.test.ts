/**
 * The layer fold, pinned through `resolveConfig` — the only way into it now that `defineLayeredConfig`
 * does the folding. A project file DISPLACING the user's hooks instead of adding to them is the
 * difference between a repository adding a hook and a repository removing yours, and a hook is
 * arbitrary command execution on every tool call.
 */
import { describe, expect, it } from 'vitest'

import { resolveConfig } from '../../src/config/config.js'

describe('resolveConfig — later layers win', () => {
  it('test_a_later_layer_replaces_an_earlier_value', () => {
    expect(resolveConfig({ user: { model: 'a/small' }, project: { model: 'a/large' } }).model).toBe(
      'a/large',
    )
  })

  it('test_a_layer_that_omits_a_key_does_not_erase_it', () => {
    expect(resolveConfig({ user: { model: 'a/small' }, project: {} }).model).toBe('a/small')
  })

  it('test_cli_outranks_project', () => {
    expect(resolveConfig({ project: { model: 'a/p' }, cli: { model: 'a/c' } }).model).toBe('a/c')
  })
})

describe('resolveConfig — accumulating keys', () => {
  it('test_hooks_concatenate_instead_of_replacing', () => {
    const cfg = resolveConfig({
      user: { hooks: [{ event: 'Stop', command: 'user-hook' }] },
      project: { hooks: [{ event: 'Stop', command: 'project-hook' }] },
    })

    expect(
      cfg.hooks.map((h) => (h as { command: string }).command),
      'a repository silently removed the hooks the user declared globally',
    ).toEqual(['user-hook', 'project-hook'])
  })

  it('test_a_key_not_declared_accumulating_still_replaces', () => {
    // Anti-vacuity: most list-valued settings DO replace, `skills` included.
    expect(resolveConfig({ user: { skills: ['a'] }, project: { skills: ['b'] } }).skills).toEqual([
      'b',
    ])
  })

  it('test_accumulation_does_not_leak_between_calls', () => {
    const layers = { user: { hooks: [{ event: 'Stop', command: 'h' }] } }

    expect(resolveConfig(layers).hooks).toHaveLength(1)
    expect(resolveConfig(layers).hooks).toHaveLength(1)
  })
})
