/**
 * M78 T2.1 — a política de cobertura: uma lista de DECISÃO, não de inclusão.
 *
 * ## O problema que este arquivo fecha
 *
 * O barril da camada cresceu de forma **reativa** — símbolo a símbolo, sob pressão de bug. O
 * resultado medido: o SDK publica 28 subpaths e a camada cobria 9. Nada avisava quando o SDK ganhava
 * um subpath novo, então "ninguém decidiu ainda" era indistinguível de "decidimos que fica fora".
 *
 * ## Por que DECISÃO e não allowlist
 *
 * Uma allowlist só do que entra deixa um subpath novo cair em silêncio na categoria "não decidido".
 * Foi exatamente assim que a cobertura chegou a 9 de 28 sem ninguém notar. Aqui, **cada** subpath
 * precisa de veredito: `in` (e o teste verifica que atravessa) ou `out` (com razão escrita).
 *
 * O teste falha quando **falta veredito** — não quando o veredito é `out`. Isso é o que separa
 * política de muro: um subpath novo no SDK quebra o build da camada **uma vez**, e o conserto é
 * escrever uma linha dizendo o que se decidiu, inclusive "fora de escopo porque X".
 *
 * Precedente do formato: `rules/code-quality-golden-rule.md § 4` já exige razão obrigatória em toda
 * entrada de allowlist, pelo mesmo motivo — uma exceção sem razão nunca é revisitada.
 *
 * ## Identidade referencial, herdada do M73
 *
 * `auth-parity.test.ts` já explicou por que a asserção é `toBe` e não `toBeDefined`: se o build
 * inlinear o SDK (`noExternal` no tsup), a camada passa a exportar uma **cópia** da classe,
 * `instanceof` vira `false` em silêncio e **nenhum teste de comportamento fica vermelho**. Um
 * `toBeDefined` não pega isso.
 */
import { createRequire } from 'node:module'

import { describe, expect, it } from 'vitest'

const require_ = createRequire(import.meta.url)

/** Um subpath re-exportado pela camada, com os símbolos que precisam atravessar. */
interface Inside {
  readonly verdict: 'in'
  /**
   * `'total'` — cada export do subpath atravessa, e o teste verifica isso enumerando o módulo do SDK.
   * `'amostra'` — só os `simbolos` listados são verificados.
   *
   * A distinção nasceu de um defeito real deste milestone: a primeira versão só amostrava, e
   * `RateLimitError` — que o refresh OAuth precisa para reconhecer um 429 — ficou de fora do
   * re-export sem nada acusar. Amostrar prova que ALGO atravessa, não que o domínio atravessa.
   */
  readonly cobertura: 'total' | 'amostra'
  /** Nomes conhecidamente NÃO cobertos, com a razão. Só válido com `cobertura: 'total'`. */
  readonly lacunas?: Readonly<Record<string, string>>
  /**
   * Símbolos-chave verificados por identidade referencial.
   *
   * Lista vazia é legítima APENAS quando `via` é um subpath próprio da camada (`/auth`, `/sandbox`,
   * …): ali a cobertura é o subpath inteiro, e o M73 já tem teste de paridade dedicado
   * (`auth-parity.test.ts`). Para um `in` via barril, lista vazia seria um veredito NÃO VERIFICADO —
   * exatamente o defeito que esta política existe para impedir, e o teste
   * `test_in_via_the_barrel_declares_symbols` o proíbe.
   */
  readonly simbolos: readonly string[]
  /**
   * De onde a camada os expõe. É o caminho do FONTE (`../../src/…`), não o nome do pacote.
   *
   * A primeira versão usava `'@theokit/agents'`, que resolve para o pacote INSTALADO em
   * `node_modules` — então o teste media a versão publicada, não a árvore sob teste, e um re-export
   * recém-escrito continuava vermelho. `auth-parity.test.ts` (M73) já importava do fonte pelo mesmo
   * motivo; eu não segui o precedente e paguei por isso.
   */
  readonly via: string
}

/** Um subpath deliberadamente fora, com a razão — que é obrigatória. */
interface Fora {
  readonly verdict: 'out'
  readonly reason: string
}

type Decision = Inside | Fora

/**
 * A lista de decisão. Cada subpath publicado pelo SDK aparece aqui.
 *
 * Adicionar um subpath ao SDK e não a esta lista quebra `test_every_sdk_subpath_has_a_verdict` —
 * de propósito.
 */
const DECISIONS: Record<string, Decision> = {
  '.': {
    verdict: 'in',
    via: '../../src/index.js',
    cobertura: 'amostra',
    // M80 — `JudgeCredentialError` entra na amostra do barril: é o erro que a falha-rápida do judge
    // lança, e um consumidor atrás da fronteira precisa dele para distinguir credencial-do-judge de
    // qualquer outra falha do goal loop.
    simbolos: ['Agent', 'Squad', 'Tool', 'Provider', 'JudgeCredentialError'],
  },
  './errors': {
    verdict: 'in',
    via: '../../src/index.js',
    cobertura: 'total',
    simbolos: ['TheokitAgentError', 'AuthenticationError', 'isTransientError', 'RateLimitError'],
    // M91 — a `lacuna` de `BudgetExceededError` SAIU: a classe da camada foi renomeada para
    // `DelegationBudgetExceededError` (com alias `@deprecated` por uma major), e o barril passou a
    // exportar as DUAS. A razão escrita aqui dizia que renomear era breaking e estava fora do escopo
    // do M78 — o M91 pagou a conta, e a lacuna some junto com o conflito que a criou.
  },
  './retry': {
    verdict: 'in',
    via: '../../src/index.js',
    cobertura: 'total',
    simbolos: ['Retry'],
  },
  './concurrency': {
    verdict: 'in',
    via: '../../src/index.js',
    cobertura: 'total',
    simbolos: ['Semaphore', 'mapWithConcurrency'],
  },
  './messages': {
    verdict: 'in',
    via: '../../src/index.js',
    cobertura: 'total',
    simbolos: ['assistantText', 'extractToolUses', 'costAmountUsd'],
  },
  './models': {
    verdict: 'in',
    via: '../../src/index.js',
    cobertura: 'total',
    simbolos: ['parseModelId'],
  },
  './compaction': {
    verdict: 'in',
    via: '../../src/index.js',
    cobertura: 'amostra',
    simbolos: ['resolveEffectiveContextWindow', 'CONTEXT_WINDOW_MARGIN'],
  },
  './path-safety': {
    verdict: 'in',
    via: '../../src/index.js',
    cobertura: 'amostra',
    simbolos: ['isForbiddenPath', 'safePathJoin', 'assertNoSymlinkEscape'],
  },
  './subagents-loader': {
    verdict: 'in',
    via: '../../src/index.js',
    cobertura: 'amostra',
    // M81 — o loader de subagents em disco. Atravessa porque a assimetria oposta (skills com porta
    // pública, subagents sem) é o que fez o consumidor escrever um SEGUNDO parser de `.md`, junto
    // com um teste cuja única função era vigiar a divergência entre os dois.
    simbolos: ['discoverSubagents', 'loadSubagentDefinition'],
  },
  './a2a': {
    verdict: 'in',
    via: '../../src/index.js',
    cobertura: 'amostra',
    simbolos: ['SubAgent'],
  },
  './auth': { verdict: 'in', via: '../../src/auth-entry.js', cobertura: 'amostra', simbolos: [] },
  './sandbox': {
    verdict: 'in',
    via: '../../src/sandbox-entry.js',
    // M90 — era `'amostra'` com lista VAZIA, que é amostra nenhuma. O comentário deste arquivo já diz
    // que amostrar "prova que ALGO atravessa, não que o domínio atravessa"; uma amostra de tamanho
    // zero não prova nem isso. Virou `'total'` quando o entry deixou de ser `export *`: agora cada
    // export da fonte é enumerado, então a cobertura total passa sem `lacunas`.
    cobertura: 'total',
    simbolos: [],
  },
  './persistence': {
    verdict: 'in',
    via: '../../src/persistence-entry.js',
    // M90 — era `'amostra'` com lista VAZIA, que é amostra nenhuma. O comentário deste arquivo já diz
    // que amostrar "prova que ALGO atravessa, não que o domínio atravessa"; uma amostra de tamanho
    // zero não prova nem isso. Virou `'total'` quando o entry deixou de ser `export *`: agora cada
    // export da fonte é enumerado, então a cobertura total passa sem `lacunas`.
    cobertura: 'total',
    simbolos: [],
  },
  './interactive': {
    verdict: 'in',
    via: '../../src/interactive-entry.js',
    // M90 — era `'amostra'` com lista VAZIA, que é amostra nenhuma. O comentário deste arquivo já diz
    // que amostrar "prova que ALGO atravessa, não que o domínio atravessa"; uma amostra de tamanho
    // zero não prova nem isso. Virou `'total'` quando o entry deixou de ser `export *`: agora cada
    // export da fonte é enumerado, então a cobertura total passa sem `lacunas`.
    cobertura: 'total',
    simbolos: [],
  },

  // --- FORA, com razão. Nenhuma destas é silenciosa. ---
  './internal/memory-adapters': {
    verdict: 'out',
    reason:
      'Subpath SEMVER-EXEMPT, publicado pelo `@theokit/sdk@4.39.0` (theokit#160) com um único ' +
      'propósito: deixar o `@theokit/sdk-memory` reusar o runtime de embeddings do SDK em vez de ' +
      'manter a cópia de 342 linhas que causou a lacuna de adapters do theokit#128. Atravessar a ' +
      'camada com ele colocaria na superfície pública um caminho que o SDK declara livre para ' +
      'quebrar em minor — o oposto do contrato que esta lista existe para proteger.',
  },
  './cron': {
    verdict: 'out',
    reason:
      'Agendamento é responsabilidade do host (systemd/CI/cloud scheduler), não do agente. Nenhum ' +
      'consumidor pediu, e expor cria a expectativa de que a camada gerencia o ciclo de vida.',
  },
  './skills': {
    verdict: 'out',
    reason:
      'A camada tem seu próprio `skills-resolver.ts`, que é a superfície OO desse domínio. Expor a ' +
      'primitiva do SDK ao lado criaria duas portas para a mesma coisa.',
  },
  './project': {
    verdict: 'out',
    reason:
      'Descoberta de raiz de projeto — o consumidor resolve o cwd por conta própria. Sem demanda.',
  },
  './subagents': {
    verdict: 'out',
    reason:
      'A delegação chega por `SubAgent` (via `/a2a`, já `in`). Este subpath é a mecânica de carga de ' +
      'arquivo, que é detalhe interno do runtime.',
  },
  './task-store': {
    verdict: 'out',
    reason:
      'Persistência de tarefa é interna ao runtime; o consumidor observa por `Run`, não pelo store.',
  },
  './workflow': {
    verdict: 'out',
    reason:
      'Orquestração de workflow é um domínio que a camada ainda não modelou. Entra quando houver demanda real.',
  },
  './eval': {
    verdict: 'out',
    reason: 'Ferramental de avaliação é de desenvolvimento, não de runtime do agente.',
  },
  './server/auth': {
    verdict: 'out',
    reason:
      'Superfície de servidor HTTP; a camada é de agente. `@theokit/http` é o pacote desse domínio.',
  },
  './server/errors-envelope': {
    verdict: 'out',
    reason: 'Mesma razão de `/server/auth` — envelope de erro de transporte HTTP, não de agente.',
  },
  './subscription': {
    verdict: 'out',
    reason: 'Billing/quota é do produto, não do framework de agente.',
  },
  './sanitize': {
    verdict: 'out',
    reason:
      'Redação de segredo é aplicada pelo runtime do SDK nos seus próprios sinks. Expor convida o ' +
      'consumidor a redigir por conta, que é onde se esquece um caminho.',
  },
  './internal/persistence': {
    verdict: 'out',
    reason: 'Marcado `internal/` pelo próprio SDK — re-exportar contradiz a intenção da origem.',
  },
  './internal/security': {
    verdict: 'out',
    reason: 'Idem `internal/persistence`.',
  },
  './client': {
    verdict: 'out',
    reason:
      'Cliente HTTP do modo cloud; a camada cobre o modo local. Entra se/quando cloud for suportado aqui.',
  },
  './filesystem': {
    verdict: 'out',
    reason:
      'As operações de arquivo que o consumidor precisa chegam como TOOLS (`@theokit/agents/tools`), ' +
      'que já carregam o guard de escopo. A primitiva crua contornaria esse guard.',
  },
}

/**
 * M90 — por que `/tools` e `/pty` NÃO entram neste mapa.
 *
 * A revisão do M90 apontou, corretamente, que eles ficavam sem oráculo — 98 dos 173 símbolos (57%), e
 * foi por ali que `TruncationMode` sumiu da superfície publicada do `4.25.0`. A correção **não** foi
 * estendê-los aqui: este mapa enumera os subpaths de `@theokit/sdk`, e `/tools` e `/pty` vêm de
 * pacotes IRMÃOS (`@theokit/sdk-tools`, `@theokit/sdk-pty`). Trazê-los exigiria uma segunda fonte de
 * verdade ao lado desta, e duas listas que precisam ficar em sincronia é o defeito que o review F-10
 * deste próprio arquivo registrou (a cópia que perdeu `bench` enquanto o comentário jurava "mesmo
 * escopo").
 *
 * Quem cobre os cinco é `subpath-surface.test.ts`, com um oráculo MAIS forte que `cobertura: 'total'`:
 * compara o que a camada emite (`dist/*.d.ts`) contra o que a fonte exporta, nas duas direções.
 */
const SUBPATHS_DO_SDK = Object.keys(
  (require_('@theokit/sdk/package.json') as { exports: Record<string, unknown> }).exports,
).filter((k) => k !== './package.json')

describe('M78 T2.1 — subpath coverage policy', () => {
  it('test_every_sdk_subpath_has_a_verdict', () => {
    const withoutDecision = SUBPATHS_DO_SDK.filter((s) => DECISIONS[s] === undefined)

    expect(
      withoutDecision,
      `Subpath(s) do SDK sem veredito: ${withoutDecision.join(', ')}.\n` +
        'Isto é intencional: um subpath novo no SDK quebra este teste UMA vez, e o conserto é ' +
        'escrever a decisão em DECISOES — inclusive `out` com razão. Sem isto, "ninguém decidiu" ' +
        'fica indistinguível de "decidimos que fica fora", que é como a cobertura chegou a 9 de 28.',
    ).toEqual([])
  })

  it('test_the_list_does_not_reference_a_NONEXISTENT_subpath', () => {
    // O inverso: uma decisão órfã (subpath removido do SDK) também precisa aparecer, senão a lista
    // acumula entradas mortas e passa a mentir sobre o que foi decidido.
    const orfas = Object.keys(DECISIONS).filter((s) => !SUBPATHS_DO_SDK.includes(s))
    expect(orfas, `Decisão para subpath que o SDK não publica mais: ${orfas.join(', ')}`).toEqual(
      [],
    )
  })

  it('test_in_via_the_barrel_declares_symbols', () => {
    // Um `in` sem símbolo é um veredito que nada verifica — documenta cobertura sem prová-la. Só é
    // aceitável quando a camada tem subpath PRÓPRIO para o domínio (aí o subpath é a cobertura).
    const unverified = Object.entries(DECISIONS)
      .filter(
        ([, d]) => d.verdict === 'in' && d.simbolos.length === 0 && d.via === '../../src/index.js',
      )
      .map(([s]) => s)
    expect(
      unverified,
      `\`in\` via barril sem símbolo declarado: ${unverified.join(', ')}. ` +
        'Um veredito que nada verifica é pior que nenhum — ele afirma cobertura que ninguém checou.',
    ).toEqual([])
  })

  it('test_every_OUT_verdict_has_a_non_empty_reason', () => {
    // CONTRAPROVA da política. Sem isto, `out` sem razão viraria a allowlist silenciosa que o
    // formato existe para impedir — e ninguém revisitaria a decisão.
    const withoutReason = Object.entries(DECISIONS)
      .filter(([, d]) => d.verdict === 'out' && (d as Fora).reason.trim().length < 20)
      .map(([s]) => s)
    expect(
      withoutReason,
      `Veredito \`out\` sem razão escrita: ${withoutReason.join(', ')}`,
    ).toEqual([])
  })

  const entradas = Object.entries(DECISIONS).filter(
    (e): e is [string, Inside] => e[1].verdict === 'in' && e[1].simbolos.length > 0,
  )

  it.each(entradas)('test_os_simbolos_de_%s_ATRAVESSAM_a_camada', async (subpath, decisao) => {
    // O `in` é VERIFICADO, não confiado. Uma decisão que diz "in" para um subpath que não atravessa
    // é pior que nenhuma decisão: ela documenta uma cobertura que não existe.
    const layer = (await import(decisao.via)) as Record<string, unknown>
    for (const nome of decisao.simbolos) {
      expect(
        layer[nome],
        `\`${nome}\` (de ${subpath}) não atravessa a camada por ${decisao.via}`,
      ).toBeDefined()
    }
  })

  const totals = Object.entries(DECISIONS).filter(
    (e): e is [string, Inside] => e[1].verdict === 'in' && e[1].cobertura === 'total',
  )

  it.each(totals)('test_%s_atravessa_por_INTEIRO_e_nao_por_amostra', async (subpath, decisao) => {
    // O teste que existe por causa de um defeito real: a primeira versão só amostrava símbolos, e
    // `RateLimitError` ficou de fora do re-export sem nada acusar — o refresh OAuth precisava dela
    // para reconhecer um 429. Amostrar prova que ALGO atravessa, não que o DOMÍNIO atravessa.
    const layer = (await import(decisao.via)) as Record<string, unknown>
    const sdk = (await import(`@theokit/sdk${subpath.slice(1)}`)) as Record<string, unknown>

    const missing = Object.keys(sdk).filter(
      (nome) => layer[nome] === undefined && decisao.lacunas?.[nome] === undefined,
    )
    expect(
      missing,
      `Exports de ${subpath} que não atravessam: ${missing.join(', ')}. ` +
        'Ou re-exporte, ou registre em `lacunas` com a razão — uma hierarquia pela metade faz o ' +
        'consumidor recriar a classe que falta, que é o defeito que este milestone fecha.',
    ).toEqual([])
  })

  it.each(totals)('test_as_lacunas_de_%s_tem_razao_escrita', (_subpath, decisao) => {
    // CONTRAPROVA: sem isto, `lacunas` viraria a allowlist silenciosa que a política proíbe.
    for (const [nome, reason] of Object.entries(decisao.lacunas ?? {})) {
      expect(reason.trim().length, `lacuna \`${nome}\` sem razão escrita`).toBeGreaterThan(30)
    }
  })

  it.each(entradas)(
    'test_os_simbolos_de_%s_sao_a_MESMA_referencia_do_sdk',
    async (subpath, decisao) => {
      // `toBe`, não `toBeDefined` — a lição do M73. Um wrapper passaria no teste anterior e quebraria
      // `instanceof` aqui, em silêncio, sem nenhum teste de comportamento ficar vermelho.
      const layer = (await import(decisao.via)) as Record<string, unknown>
      const sdk = (await import(`@theokit/sdk${subpath.slice(1)}`)) as Record<string, unknown>
      for (const nome of decisao.simbolos) {
        expect(layer[nome], `\`${nome}\` atravessa como CÓPIA, não como a classe do SDK`).toBe(
          sdk[nome],
        )
      }
    },
  )
})
