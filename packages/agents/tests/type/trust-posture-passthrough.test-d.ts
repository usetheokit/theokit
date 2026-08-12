/**
 * M68 T1 — o vocabulário de confiança do SDK atravessa o barrel.
 *
 * Asserções de COMPILAÇÃO: `npx tsc --noEmit -p packages/agents/tsconfig.test.json` falha se algum
 * destes nomes deixar de ser nomeável a partir de `@theokit/agents`, ou deixar de ser o tipo do SDK.
 *
 * ## Por que estes quatro, e por que agora
 *
 * O M68 passa a exigir uma `TrustPosture` para habilitar o source `project` de `settingSources` — o
 * que liga hooks executores de shell vindos do diretório de trabalho. Uma API que exige um valor cujo
 * TIPO o consumidor não consegue nomear é inutilizável: ele teria de redeclarar a forma à mão, e uma
 * segunda declaração de um contrato de segurança diverge da primeira em silêncio.
 *
 * O ADR 0061 (M67) declarou honestamente que o gate ROOT-BAR cobre valores e não tipos, porque
 * `Object.keys` sobre o namespace não enxerga `export type`. Estes quatro fecham essa lacuna onde ela
 * importa — não por completude, mas porque o M68 depende deles.
 */
import { expectTypeOf } from 'vitest'

import type { TrustLevel, TrustPosture, TrustPostureInput, TrustSource } from '../../src/index.js'
import type {
  TrustLevel as SdkTrustLevel,
  TrustPosture as SdkTrustPosture,
  TrustPostureInput as SdkTrustPostureInput,
  TrustSource as SdkTrustSource,
} from '@theokit/sdk'

// ── 1. Nomeáveis a partir do barrel ───────────────────────────────────────────────────────────
expectTypeOf<TrustLevel>().not.toBeNever()
expectTypeOf<TrustSource>().not.toBeNever()
expectTypeOf<TrustPosture<'project'>>().not.toBeNever()
expectTypeOf<TrustPostureInput<'project'>>().not.toBeNever()

// ── 2. São os tipos do SDK, não uma redeclaração ──────────────────────────────────────────────
// Pass-through, nunca wrapper (Rung 9). Uma cópia estruturalmente igual divergiria de upstream em
// silêncio, que é o defeito que a fronteira em camadas existe para fechar.
expectTypeOf<TrustLevel>().toEqualTypeOf<SdkTrustLevel>()
expectTypeOf<TrustSource>().toEqualTypeOf<SdkTrustSource>()
expectTypeOf<TrustPosture<'project'>>().toEqualTypeOf<SdkTrustPosture<'project'>>()
expectTypeOf<TrustPostureInput<'project'>>().toEqualTypeOf<SdkTrustPostureInput<'project'>>()

// ── 3. As duas propriedades de que o gate do M68 depende ──────────────────────────────────────
// `level` distingue confiado de não-confiado; `source` diz DE ONDE veio a decisão, e é o que torna a
// mensagem de recusa acionável ("negado, e a decisão veio de `default`") em vez de apenas negativa.
expectTypeOf<TrustPosture<'project'>>().toHaveProperty('level').toEqualTypeOf<SdkTrustLevel>()
expectTypeOf<TrustPosture<'project'>>().toHaveProperty('source').toEqualTypeOf<SdkTrustSource>()
expectTypeOf<TrustPosture<'project'>>()
  .toHaveProperty('allows')
  .toEqualTypeOf<Readonly<Record<'project', boolean>>>()
