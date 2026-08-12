/**
 * M68 T2 — habilitar o source do repositório com um literal de string não compila.
 *
 * Asserções de COMPILAÇÃO. Cada `@ts-expect-error` abaixo **precisa** errar; o teste quebra quando
 * uma delas para de errar, que é o dia em que o caminho inseguro voltou a nascer.
 *
 * ## O que este arquivo protege
 *
 * `settingSources` habilita a descoberta de config em disco. `'user'` lê `~/.theokit/` — a máquina do
 * operador, que não é controlada por terceiro. `'project'` lê `<cwd>/.theokit/`, **incluindo
 * `hooks.json`, que executa shell**. Para um agente cujo `cwd` é um repositório que o usuário acabou
 * de clonar, `<cwd>/.theokit/` é conteúdo do atacante.
 *
 * A JSDoc anterior documentava esse risco e o justificava com "`.theokit/` é o repo do próprio app".
 * Documentar não impediu: o consumidor medido (TheoCode) não confiou na API e gateou por fora, com
 * uma `posture.allows` própria. O gate existia do lado dele e evaporava na fronteira.
 *
 * Controle de tipo fechado, não lint: a chamada errada não nasce. Residuo declarado, no molde do
 * narrowing de `Agent.list` (M103) — liga consumidores TypeScript apenas; um `.js` ou um `as any`
 * escapam, e é a recusa em runtime (T3) que os cobre.
 */
import type { SettingSourcesSelection, TrustPosture } from '../../src/index.js'

declare const trusted: TrustPosture<'projectSettings'>

  // ── 1. O caminho seguro continua trivial ──────────────────────────────────────────────────────
  // Se recusar exigisse cerimônia do caminho seguro, a fricção empurraria o consumidor a desligar o
  // gate — que é o resultado oposto ao pretendido.
;({ user: true }) satisfies SettingSourcesSelection
;({}) satisfies SettingSourcesSelection

// ── 2. O source do repositório exige a evidência ──────────────────────────────────────────────
;({ project: { trustedBy: trusted } }) satisfies SettingSourcesSelection
;({ user: true, project: { trustedBy: trusted } }) satisfies SettingSourcesSelection

// ── 3. As formas que precisam NÃO compilar ────────────────────────────────────────────────────
{
  // @ts-expect-error — a forma antiga: um array de literais. É o call site que este milestone mata.
  ;['project', 'user'] satisfies SettingSourcesSelection
}
{
  // @ts-expect-error — um booleano no lugar da evidência. Ligar o source perigoso não é uma opinião.
  ;({ project: true }) satisfies SettingSourcesSelection
}
{
  // @ts-expect-error — `trustedBy` ausente: o objeto existe, a evidência não.
  ;({ project: {} }) satisfies SettingSourcesSelection
}
{
  // @ts-expect-error — uma string no lugar da posture. Alegar confiança não é prová-la; era
  // exatamente a forma de `auto-approve` que o M77 vai corrigir pelo mesmo motivo.
  ;({ project: { trustedBy: 'eu confio' } }) satisfies SettingSourcesSelection
}
