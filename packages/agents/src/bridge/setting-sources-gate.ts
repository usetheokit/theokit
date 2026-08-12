import type { SettingSource, TrustPosture } from '@theokit/sdk'
import { TheokitAgentError } from '@theokit/sdk/errors'

/**
 * M68 — o gate de confiança do `settingSources`.
 *
 * ## O defeito que este módulo fecha
 *
 * `settingSources` habilita a descoberta de config em disco. `'user'` lê `~/.theokit/` — a máquina do
 * operador, que não é controlada por terceiro. `'project'` lê `<cwd>/.theokit/`, **incluindo
 * `hooks.json`, que executa shell**.
 *
 * A API anterior aceitava `readonly SettingSource[]`, e a JSDoc justificava o risco assim: *"é opt-in
 * porque `.theokit/` é o repo do próprio app (consentimento informado)"*. A premissa vale para um app
 * web cujo `cwd` é o próprio deploy. **Não vale** para a classe de produto que o framework endereça —
 * um agente cujo `cwd` é um repositório que o usuário acabou de clonar. Ali `.theokit/` é conteúdo
 * controlado pelo atacante, e habilitar `'project'` é execução remota de código no primeiro `build()`.
 *
 * Documentar não impediu. O consumidor medido (TheoCode) não confiou na API: gateou por fora, com uma
 * `posture.allows` própria (`chat.ts:386`, comentário B-008). Ele **já tinha** a decisão certa e não
 * conseguia passá-la adiante, porque a API só aceitava strings. O gate existia do lado dele e
 * evaporava na fronteira.
 *
 * ## A evidência é a do SDK, não uma inventada aqui
 *
 * `TrustPosture` é a primitiva de confiança do próprio `@theokit/sdk`, e a doc de `recordWiring` diz
 * que *"uma posture é a única coisa neste pacote que retém uma capacidade"*. Criar um tipo próprio
 * faria duas gramáticas de confiança conviverem e divergirem (ADR 0063).
 */

/**
 * O vocabulário de capacidades do framework — deliberadamente de um nome só (ADR 0065).
 *
 * `allows` é all-or-nothing no SDK: todo `K` declarado recebe o mesmo booleano. Um vocabulário mais
 * fino (`hooks`, `skills`, `subagents`, `mcp`) prometeria ao consumidor gatear um sem gatear o outro,
 * e a primitiva não entrega isso. Uma API que sugere uma distinção que o runtime não faz ensina
 * errado, e o erro só aparece quando alguém depende da distinção.
 */
export type SettingSourceCapability = 'projectSettings'

/** A autorização para ler config do diretório de trabalho. Exige a posture, nunca uma afirmação. */
export interface ProjectSettingsGrant {
  /**
   * Tipicamente a saída de `resolveTrustPosture` — o que lhe dá `source` (`'env' | 'store' |
   * 'default'`) e, portanto, uma recusa que diz DE ONDE veio a decisão em vez de apenas negar.
   */
  readonly trustedBy: TrustPosture<SettingSourceCapability>
}

/**
 * Quais raízes de config em disco o agente pode ler.
 *
 * A assimetria é o desenho: `user` é um booleano porque `~/.theokit/` é do operador; `project` exige
 * evidência porque `<cwd>/.theokit/` pode não ser dele. Omitir uma raiz é não habilitá-la — nunca
 * "habilitar sem gate". A assimetria é herdada do próprio SDK, cuja `TrustPostureInput.envOverride`
 * documenta que `false` e `undefined` ambos significam "o operador não ligou", não "desligou".
 */
export interface SettingSourcesSelection {
  /** `~/.theokit/` — a máquina do operador. Sem gate: não é controlada por terceiro. */
  readonly user?: boolean
  /** `<cwd>/.theokit/` — controlado por quem escreveu o repositório aberto. Exige evidência. */
  readonly project?: ProjectSettingsGrant
}

/**
 * Recusa de leitura do diretório de trabalho por falta de confiança.
 *
 * Descende de `TheokitAgentError` porque o repo mantém erros tipados como regra inquebrável — e
 * porque `isTransientError` só enxerga essa hierarquia. Uma classe estendendo `Error` puro seria
 * invisível ao predicado que separa recuperável de irrecuperável (foi o defeito que o M67 corrigiu em
 * cinco classes).
 */
export class UntrustedSettingSourceError extends TheokitAgentError {
  override readonly name = 'UntrustedSettingSourceError'

  constructor(
    message: string,
    /** De onde veio a decisão de confiança: `'env' | 'store' | 'default'`. */
    readonly trustSource: string,
    /** A capacidade recusada. */
    readonly capability: SettingSourceCapability,
  ) {
    super(message)
  }
}

/**
 * Traduz a seleção declarada para os `SettingSource` que o SDK aceita, recusando o que a posture não
 * autoriza.
 *
 * Recusa em vez de ignorar (ADR 0064). Ignorar deixaria o produto rodando acreditando que os hooks do
 * repositório estão ativos — modo de falha silencioso e do lado errado. O SDK já escolheu esse lado
 * para o mesmo problema: `recordWiring` lança `UngatedCapabilityError` quando alguém registra uma
 * capacidade que a posture não gateia.
 *
 * @throws {UntrustedSettingSourceError} quando `project` é pedido e a posture não o concede.
 */
export function resolveSettingSources(
  selection: SettingSourcesSelection | undefined,
): readonly SettingSource[] {
  if (selection === undefined) return []

  const sources: SettingSource[] = []
  if (selection.user === true) sources.push('user')

  const grant = selection.project
  if (grant !== undefined) {
    const posture = grant.trustedBy
    if (!posture.allows.projectSettings) {
      throw new UntrustedSettingSourceError(
        `the \`project\` setting source reads <cwd>/.theokit/ — including shell-executing hooks — ` +
          `and the posture does not grant \`projectSettings\` (level: ${posture.level}, decided ` +
          `by: ${posture.source}). Grant it with a trusted posture, or omit \`project\` to read ` +
          `only the operator's own ~/.theokit/.`,
        posture.source,
        'projectSettings',
      )
    }
    sources.push('project')
  }

  return sources
}
