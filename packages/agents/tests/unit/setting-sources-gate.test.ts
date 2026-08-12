import { describe, expect, it } from 'vitest'

import {
  resolveSettingSources,
  UntrustedSettingSourceError,
  type SettingSourceCapability,
} from '../../src/bridge/setting-sources-gate.js'
import { TheokitAgentError, resolveTrustPosture } from '../../src/index.js'
import type { TrustPosture } from '../../src/index.js'

/**
 * M68 T3 — a recusa em runtime.
 *
 * O controle de tipo (`tests/type/setting-sources-gate.test-d.ts`) impede que a chamada errada NASÇA,
 * mas liga consumidores TypeScript apenas — um `.js` ou um `as any` escapam. É a residualidade
 * declarada no narrowing de `Agent.list` (M103), e estes testes são o que a cobre.
 *
 * As duas lentes de `.claude/rules/testing.md` § 4.1 estão aqui de propósito. A negativa é o coração
 * do milestone; a positiva existe porque uma guarda que proibisse TUDO passaria numa suíte feita só de
 * casos negativos, e seria breaking change disfarçado de segurança.
 */

/** Constrói a posture pelo caminho real do SDK, não por objeto literal — a proveniência importa. */
function postureFrom(opts: {
  isTrusted: boolean
  envOverride?: boolean
}): TrustPosture<SettingSourceCapability> {
  return resolveTrustPosture<SettingSourceCapability>({
    capabilities: ['projectSettings'],
    isTrusted: () => opts.isTrusted,
    envOverride: opts.envOverride,
  })
}

describe('M68 T3 — o caminho seguro continua trivial', () => {
  it('test_user_source_needs_no_posture', () => {
    // Se recusar exigisse cerimônia do caminho seguro, a fricção empurraria o consumidor a desligar o
    // gate — o resultado oposto ao pretendido.
    expect(resolveSettingSources({ user: true })).toEqual(['user'])
  })

  it('test_an_empty_selection_enables_nothing', () => {
    expect(resolveSettingSources({})).toEqual([])
  })

  it('test_an_absent_selection_enables_nothing', () => {
    // Omitir é não habilitar, nunca "habilitar sem gate" — a mesma assimetria que o SDK documenta em
    // `TrustPostureInput.envOverride`: `undefined` é "o operador não ligou", não "desligou".
    expect(resolveSettingSources(undefined)).toEqual([])
  })
})

describe('M68 T3 — a recusa', () => {
  it('test_project_source_is_refused_when_the_posture_is_untrusted', () => {
    const untrusted = postureFrom({ isTrusted: false })
    expect(() => resolveSettingSources({ project: { trustedBy: untrusted } })).toThrowError(
      UntrustedSettingSourceError,
    )
  })

  it('test_the_refusal_is_a_typed_error_of_the_sdk_hierarchy', () => {
    // Um erro estendendo `Error` puro seria invisível a `isTransientError`, que só enxerga esta
    // hierarquia — foi o defeito que o M67 corrigiu em cinco classes.
    const untrusted = postureFrom({ isTrusted: false })
    try {
      resolveSettingSources({ project: { trustedBy: untrusted } })
      expect.unreachable('should have refused')
    } catch (err) {
      expect(err).toBeInstanceOf(TheokitAgentError)
      expect((err as UntrustedSettingSourceError).name).toBe('UntrustedSettingSourceError')
    }
  })

  it('test_the_refusal_names_the_capability_and_the_trust_source', () => {
    // "negado" não é acionável; "negado, e a decisão veio de `default`" é. A proveniência vem de
    // graça da `TrustPosture` — é metade do motivo de ela ser a evidência exigida (ADR 0063).
    const untrusted = postureFrom({ isTrusted: false })
    try {
      resolveSettingSources({ project: { trustedBy: untrusted } })
      expect.unreachable('should have refused')
    } catch (err) {
      const refusal = err as UntrustedSettingSourceError
      expect(refusal.capability).toBe('projectSettings')
      expect(refusal.trustSource).toBe('default')
      expect(refusal.message).toMatch(/shell-executing hooks/)
      expect(refusal.message).toMatch(/decided by: default/)
    }
  })

  it('test_the_refusal_does_not_silently_downgrade_to_user_only', () => {
    // Rebaixar seria "ignorar com esperteza": o consumidor pediu A, recebeu B, e a diferença só
    // aparece quando um hook que ele esperava não roda (ADR 0064, alternativa 3).
    const untrusted = postureFrom({ isTrusted: false })
    expect(() => resolveSettingSources({ user: true, project: { trustedBy: untrusted } })).toThrow()
  })
})

describe('M68 T3 — a concessão', () => {
  it('test_project_source_is_wired_when_the_posture_is_trusted_by_the_store', () => {
    const trusted = postureFrom({ isTrusted: true })
    expect(trusted.source).toBe('store')
    expect(resolveSettingSources({ project: { trustedBy: trusted } })).toEqual(['project'])
  })

  it('test_project_source_is_wired_when_trust_came_from_an_env_override', () => {
    const trusted = postureFrom({ isTrusted: false, envOverride: true })
    expect(trusted.source).toBe('env')
    expect(resolveSettingSources({ project: { trustedBy: trusted } })).toEqual(['project'])
  })

  it('test_both_sources_are_wired_in_a_stable_order', () => {
    const trusted = postureFrom({ isTrusted: true })
    expect(resolveSettingSources({ user: true, project: { trustedBy: trusted } })).toEqual([
      'user',
      'project',
    ])
  })

  it('test_an_env_override_of_false_does_not_grant', () => {
    // O SDK é explícito: `false` e `undefined` ambos significam "o operador não ligou", NUNCA
    // "desligou" — uma variável não-setada não pode sobrepor um store confiado. O gate herda isso.
    const untrusted = postureFrom({ isTrusted: false, envOverride: false })
    expect(untrusted.level).toBe('untrusted')
    expect(() => resolveSettingSources({ project: { trustedBy: untrusted } })).toThrow(
      UntrustedSettingSourceError,
    )
  })
})
