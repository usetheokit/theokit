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
  it('get em nome DESCONHECIDO lanca com o nome no erro', () => {
    const ts = Toolset.from([t('read_file')])
    const chamar = () => ts.get('nao_existe')
    expect(chamar).toThrow(/nao_existe/)
  })

  it('nome DUPLICADO na construcao falha alto — nao no primeiro resolve', () => {
    const construir = () => Toolset.from([t('read_file'), t('read_file')])
    expect(construir).toThrow(ToolsetError)
  })

  it('resolve com nome REPETIDO na whitelist falha alto', () => {
    const ts = Toolset.from([t('read_file'), t('grep')])
    const chamar = () => ts.resolve(['read_file', 'read_file'])
    expect(chamar).toThrow(/duplicate/)
  })

  it('resolve com nome DESCONHECIDO falha alto — nunca descarta em silencio', () => {
    const ts = Toolset.from([t('read_file')])
    const chamar = () => ts.resolve(['read_file', 'run_shell'])
    expect(chamar).toThrow(/run_shell/)
  })

  it('NAO prefixa namespace — o nome e o contrato com o modelo', () => {
    const nomes = Toolset.from([t('read_file'), t('grep')]).names()
    expect(nomes).toEqual(['read_file', 'grep'])
  })

  it('a instancia e congelada', () => {
    const congelada = Object.isFrozen(Toolset.from([t('read_file')]))
    expect(congelada).toBe(true)
  })

  it('resolve preserva a ORDEM da whitelist, nao a de registro', () => {
    const ts = Toolset.from([t('a'), t('b'), t('c')])
    const nomes = ts.resolve(['c', 'a']).map((x) => x.name)
    expect(nomes).toEqual(['c', 'a'])
  })

  it('o erro carrega um code estavel, nao so a mensagem', () => {
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
