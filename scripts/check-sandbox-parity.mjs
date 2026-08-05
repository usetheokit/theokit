#!/usr/bin/env node
/**
 * M75 T4.2 — gate de paridade do subsistema de sandbox.
 *
 * ## O problema que ele resolve
 *
 * `@theokit/agents/sandbox` é um pass-through (`export * from '@theokit/sdk/sandbox'`), então tudo
 * que o SDK exporta atravessa automaticamente. Isso é ótimo até o dia em que o SDK **remove** ou
 * **renomeia** um símbolo: o consumidor quebra em runtime, e nada no meio do caminho avisou.
 *
 * Este gate exige uma DECISÃO ESCRITA por símbolo público do subsistema. Símbolo novo sem decisão
 * falha; símbolo que sumiu do SDK mas continua declarado aqui também falha.
 *
 * ## Por que ele nasce com job de CI próprio
 *
 * O precedente é o M73: `check-auth-parity.mjs` foi escrito, ficou correto, e rodava em **zero**
 * jobs — vivia só dentro de `check:all`, que nenhum workflow invocava. O review classificou como
 * BLOCKER. Um gate que não roda não é um gate; é documentação com sintaxe de código.
 *
 * ## Piso de não-vacuidade
 *
 * Se a varredura devolver menos símbolos que o piso, o gate FALHA em vez de reportar "tudo certo".
 * "Zero símbolos, zero divergências" é verdadeiro por ausência de leitura, e é a forma mais comum de
 * um gate certificar coisa nenhuma — aconteceu seis vezes nesta série de milestones.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Piso: menos que isto significa que a varredura quebrou, não que o SDK encolheu. */
const PISO_DE_SIMBOLOS = 20

/**
 * A decisão escrita por símbolo. Toda entrada precisa de razão — a coluna existe para que a próxima
 * pessoa saiba se um símbolo é contrato público ou detalhe que vazou.
 */
const DECISOES = {
  // --- contrato do backend (pré-M75, do SDK original) ---
  SandboxBackend: 'contrato — a classe abstrata que todo backend implementa',
  LocalSandbox: 'contrato — execução local sem confinamento',
  resolveSandbox: 'contrato — resolve um SandboxProvider para um backend',
  SandboxSecurityError: 'contrato — erro tipado de violação de política',
  SandboxNotAvailableError: 'contrato — erro tipado de backend indisponível',
  provisionRepo: 'utilitário — clona um repo dentro do sandbox',
  RepoProvisionError: 'erro tipado de provisionRepo',
  ProvisionRepoOptions: 'tipo — opções de provisionRepo',
  ExecuteResult: 'tipo — o retorno de execute(); contrato entre backend e chamador',
  SandboxConfig: 'tipo — workDir/timeout/maxOutput/env que todo backend aceita',
  SandboxProvider: 'tipo — backend OU factory; é o que permite resolver por contexto',

  // --- confinamento de kernel, promovido no M75 ---
  LinuxSandbox: 'M75 — o backend com enforcement de kernel (bwrap + seccomp)',
  createSandboxBackend:
    'M75 — a factory honesta: confina quando dá, degrada com aviso quando não dá, NUNCA finge',
  wrapCommandForSandbox: 'M75 — API pública por DoD: quem compõe o wrap fora do backend',
  interactiveWrapCommand:
    'M75 — a composição para o PTY; sem ela todo consumidor reescreve detect→warn→wrap',
  resolveSandboxPosture: "M75 — API pública por DoD: a UI responde 'estou confinado agora?'",
  allowlistedEnv: 'M75 — o env re-injetado após --clearenv (modelo env_clear do Codex)',
  buildBwrapArgv: 'M75 — construção pura do argv; testável sem host',
  buildSeccompFilter: 'M75 — o programa cBPF como Buffer, JS puro',
  detectBwrap: 'M75 — detecção com probes injetáveis',
  detectBwrapMemoized: 'M75 — detecção memoizada, com revalidação de positivo obsoleto (M71)',
  realProbes: 'M75 — as sondagens reais; exportado para testes decidirem se rodam',
  realProbeCount: 'M75 — contador de sondagens; é o oráculo de gates de performance',
  resetBwrapMemo: 'M75 — reset do memo, para isolamento entre testes',
  resetSandboxWarnLatch: 'M75 — reset do latch de aviso do caminho não-interativo',
  resetInteractiveWarnLatch: 'M75 — reset do latch de aviso do caminho interativo',
  seccompPathForArch:
    'M75 — ARCH GUARD: recusa instalar seccomp fora de x86_64 e avisa. Veio de achado HIGH de review; sumir daqui é regressão de segurança',
  restrictedSeccompPath: 'M75 — o caminho do programa escrito uma vez por processo',

  // --- tipos do subsistema promovido (M75). Cada um é público porque um chamador precisa
  //     NOMEÁ-LO: sem o tipo exportado, quem injeta um probe ou lê a postura só consegue `any`.
  SandboxMode:
    "M75 — os três modos canônicos do Codex. Vocabulário do SANDBOX, não da config do consumidor: 'danger-full-access' significa 'não embrulhe'",
  BwrapArgvOptions: 'M75 — tipo — as opções de buildBwrapArgv (cwd/network/env/gitDirExists)',
  BwrapDetection:
    'M75 — tipo — o resultado discriminado da detecção: { ok:true, bin } | { ok:false, reason }. O `reason` é o que torna o downgrade HONESTO em vez de silencioso',
  BwrapProbes: 'M75 — tipo — as três sondagens injetáveis; é o que permite testar sem host',
  SeccompOptions: 'M75 — tipo — { networkRestricted }: o seccomp só é instalado com rede restrita',
  CreateSandboxBackendOptions: 'M75 — tipo — as opções da factory, com detect/warn injetáveis',
  InteractiveWrapOptions: 'M75 — tipo — as opções da composição do PTY',
  SandboxPosture:
    "M75 — tipo — { mode, enforced, detail }: o que a UI mostra. `detail` carrega o MOTIVO, sem o qual 'não confinado' deixa o usuário sem ação",
}

/**
 * ORDEM DELIBERADA: a FONTE DE AUTORIA primeiro, o pacote instalado depois.
 *
 * O `node_modules/@theokit/sdk` deste repo é um link de workspace que pode apontar para uma árvore
 * defasada — na primeira execução deste gate ele resolvia para a **4.19.2** enquanto a autoria já
 * estava em 4.21.1, e o gate reportou 18 "decisões órfãs" que não eram órfãs coisa nenhuma. Ler o
 * link primeiro faria o gate medir a cópia velha e acusar o autor de remover símbolos que ele
 * acabara de adicionar.
 *
 * Em CI a ordem também funciona: o job clona `theokit-sdk` como irmão antes de instalar.
 */
const lerEntrada = () => {
  for (const p of [
    '../theokit-sdk/packages/sdk/src/sandbox/index.ts',
    'node_modules/@theokit/sdk/dist/sandbox/index.d.ts',
  ]) {
    try {
      return { texto: readFileSync(join(RAIZ, p), 'utf8'), origem: p }
    } catch {
      // tenta o próximo — o repo pode estar instalado ou em workspace
    }
  }
  console.error(
    'FALHA: não encontrei a entrada de sandbox do SDK. O gate NÃO pode reportar sucesso sem ler nada.',
  )
  process.exit(2)
}

const { texto, origem } = lerEntrada()

/** Nomes exportados pelo barrel — cobre `export { a, b }` e `export type { T }`. */
const simbolos = new Set()
for (const bloco of texto.matchAll(/export\s*(?:type\s*)?\{([^}]*)\}/g)) {
  for (const bruto of bloco[1].split(',')) {
    // O nome PÚBLICO é o que vem DEPOIS do `as` — é ele que o consumidor importa. A primeira
    // versão pegava `[0]` (o nome de origem), e por isso um símbolo exportado sob alias escapava
    // do gate inteiro. Descoberto por mutação: acrescentar
    // `export { LinuxSandbox as SimboloNovoSemDecisao }` NÃO fazia o gate falhar.
    //
    // Tokenizar em vez de `split(/\s+as\s+/)`: aquele padrão tem dois quantificadores gulosos em
    // volta de um literal e o linter o marca como super-linear (ReDoS). A forma é `[Nome]` ou
    // `[Origem, "as", Público]`, então o último token já é a resposta — sem backtracking.
    const tokens = bruto
      .replace(/\btype\b/, '')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
    const nome = tokens.at(-1) ?? ''
    if (nome && /^[A-Za-z_$][\w$]*$/.test(nome)) simbolos.add(nome)
  }
}

const falhas = []

if (simbolos.size < PISO_DE_SIMBOLOS) {
  falhas.push(
    `PISO DE NÃO-VACUIDADE: a varredura achou ${simbolos.size} símbolos em ${origem}, abaixo do piso ` +
      `de ${PISO_DE_SIMBOLOS}. "Nenhuma divergência" sobre uma lista vazia é verdadeiro por ausência ` +
      `de leitura, não por paridade. Conserte a varredura antes de confiar no resultado.`,
  )
}

for (const nome of simbolos) {
  if (!(nome in DECISOES)) {
    falhas.push(
      `SEM DECISÃO: "${nome}" é exportado por ${origem} e atravessa @theokit/agents/sandbox, mas não ` +
        `tem entrada em DECISOES. Acrescente uma linha dizendo POR QUE ele é público.`,
    )
  }
}

for (const nome of Object.keys(DECISOES)) {
  if (!simbolos.has(nome)) {
    falhas.push(
      `DECISÃO ÓRFÃ: "${nome}" tem decisão escrita mas NÃO é mais exportado pelo SDK. Ou o símbolo ` +
        `foi removido (e a camada quebrou em silêncio), ou a decisão está obsoleta.`,
    )
  }
}

if (falhas.length > 0) {
  console.error(`\ncheck-sandbox-parity: ${falhas.length} problema(s)\n`)
  for (const f of falhas) console.error(`  - ${f}\n`)
  process.exit(1)
}

console.log(
  `check-sandbox-parity: OK — ${simbolos.size} símbolos, todos com decisão escrita (fonte: ${origem}).`,
)
