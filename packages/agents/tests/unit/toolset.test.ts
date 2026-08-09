import { describe, expect, it } from 'vitest'

import { Toolset, ToolsetError } from '../../src/capability/toolset.js'

const t = (name: string) => ({ name })

/**
 * M91 T4.1 — a política de resolução de tools vira primitiva da camada.
 *
 * O agent-builder tinha de escrevê-la: `agents/tools/registry.ts`, 170 LoC, com a política que importa
 * (falhar alto em desconhecido **e** duplicado) fora do framework. O próximo consumidor teria de
 * redescobri-la — e a chance de redescobrir "falha alto nos dois casos" é baixa.
 */
describe('M91 — Toolset', () => {
  it('get on an UNKNOWN name throws with the name in the error', () => {
    const ts = Toolset.from([t('read_file')])
    const callIt = () => ts.get('does_not_exist')
    expect(callIt).toThrow(/does_not_exist/)
  })

  it('a DUPLICATE name at construction fails loud — not on the first resolve', () => {
    const construct = () => Toolset.from([t('read_file'), t('read_file')])
    expect(construct).toThrow(ToolsetError)
  })

  it('resolve with a REPEATED name in the whitelist fails loud', () => {
    const ts = Toolset.from([t('read_file'), t('grep')])
    const callIt = () => ts.resolve(['read_file', 'read_file'])
    expect(callIt).toThrow(/duplicate/)
  })

  it('resolve with an UNKNOWN name fails loud — never discards silently', () => {
    const ts = Toolset.from([t('read_file')])
    const callIt = () => ts.resolve(['read_file', 'run_shell'])
    expect(callIt).toThrow(/run_shell/)
  })

  it('does NOT prefix a namespace — the name is the contract with the model', () => {
    const nameList = Toolset.from([t('read_file'), t('grep')]).names()
    expect(nameList).toEqual(['read_file', 'grep'])
  })

  it('the instance is frozen', () => {
    const frozenOne = Object.isFrozen(Toolset.from([t('read_file')]))
    expect(frozenOne).toBe(true)
  })

  it('resolve preserves the WHITELIST order, not the registration order', () => {
    const ts = Toolset.from([t('a'), t('b'), t('c')])
    const nameList = ts.resolve(['c', 'a']).map((x) => x.name)
    expect(nameList).toEqual(['c', 'a'])
  })

  it('the error carries a stable code, not just the message', () => {
    const ts = Toolset.from([t('a')])
    try {
      ts.get('b')
      expect.unreachable('deveria ter lançado')
    } catch (err) {
      expect((err as ToolsetError).code).toBe('unknown_tool')
    }
  })
})

/**
 * U-3 — `ToolsetError` belongs to the SDK's error hierarchy.
 *
 * It extended `Error` directly, so `catch (e) { if (e instanceof TheokitAgentError) }` — the shape
 * consumers use to tell an SDK failure from any other throw — missed it entirely. The only way to
 * recognise it was by name or by message.
 *
 * The layer already made this exact argument once, and wrote it down: M61 unified two
 * `ConfigurationError` classes because one extended `Error` and the other `TheokitAgentError`, so an
 * `instanceof` check caught one path and silently missed the other. `ToolsetError` is the same
 * defect in the same package, left standing.
 *
 * Reported from a consumer that had to write a translateError() workaround for it (finding TIP-15).
 */
describe('U-3 — ToolsetError is a TheokitAgentError', () => {
  it('test_it_is_recognised_by_the_sdk_error_hierarchy', async () => {
    const { TheokitAgentError } = await import('@theokit/sdk/errors')

    expect(
      new ToolsetError('nope', 'unknown_tool'),
      'a consumer catching TheokitAgentError misses this one, so it has to be recognised by name ' +
        'or message — the exact failure M61 unified ConfigurationError to remove',
    ).toBeInstanceOf(TheokitAgentError)
  })

  it('test_it_is_still_an_Error', () => {
    // Anti-vacuity floor: the hierarchy change must not cost the base guarantee.
    expect(new ToolsetError('nope', 'unknown_tool')).toBeInstanceOf(Error)
  })

  it('test_it_keeps_its_typed_code_and_name', () => {
    const err = new ToolsetError('nope', 'duplicate_tool')

    expect(err.code).toBe('duplicate_tool')
    expect(err.name).toBe('ToolsetError')
    expect(err.message).toBe('nope')
  })
})
