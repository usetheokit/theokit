/**
 * The layer fold, pinned through `resolveConfig` — the rule every setting in this product resolves
 * through. A hook is arbitrary command execution on every tool call, so "a project file adds to the
 * user's hooks and never displaces them" is not a style question.
 */
import { describe, expect, it } from 'vitest'

import { resolveConfig } from '../../src/config/config.js'

describe('resolveConfig — later layers win', () => {
  it('test_a_later_layer_replaces_an_earlier_value', () => {
    expect(resolveConfig({ user: { model: 'small' }, project: { model: 'large' } }).model).toBe(
      'large',
    )
  })

  it('test_cli_outranks_project_local_outranks_project', () => {
    expect(
      resolveConfig({
        user: { model: 'a' },
        project: { model: 'b' },
        projectLocal: { model: 'c' },
        cli: { model: 'd' },
      }).model,
    ).toBe('d')
    expect(resolveConfig({ project: { model: 'b' }, projectLocal: { model: 'c' } }).model).toBe('c')
  })

  it('test_a_layer_that_does_not_mention_a_key_does_not_erase_it', () => {
    expect(resolveConfig({ user: { model: 'small' }, project: {} }).model).toBe('small')
  })
})

describe('resolveConfig — accumulating keys', () => {
  it('test_hooks_concatenate_instead_of_replacing', () => {
    const user = { event: 'Stop', command: 'user-hook' }
    const project = { event: 'Stop', command: 'project-hook' }

    expect(
      resolveConfig({ user: { hooks: [user] }, project: { hooks: [project] } } as never).hooks,
      'a repository silently removed the hooks the user declared globally',
    ).toEqual([user, project])
  })

  it('test_a_key_not_declared_accumulating_still_replaces', () => {
    expect(resolveConfig({ user: { skills: ['a'] }, project: { skills: ['b'] } }).skills).toEqual([
      'b',
    ])
  })

  it('test_accumulation_does_not_leak_between_resolutions', () => {
    const layers = { user: { hooks: [{ event: 'Stop', command: 'h' }] } } as never

    expect(resolveConfig(layers).hooks).toHaveLength(1)
    expect(resolveConfig(layers).hooks).toHaveLength(1)
  })
})
