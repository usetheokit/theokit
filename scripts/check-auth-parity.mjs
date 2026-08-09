#!/usr/bin/env node
/**
 * Guard de PARIDADE DE SUPERFÍCIE — "enriquecer nunca reduz" (M73).
 *
 * A camada `@theokit/agents` existe para ENRIQUECER o `@theokit/sdk`: acrescentar OO onde há estado ou
 * orquestração a segurar. Ela nunca deve REDUZIR — um símbolo que o SDK expõe e a camada não repassa
 * fica inalcançável para quem consome a camada.
 *
 * Isso não é teoria. O `agent-builder` tem como regra INQUEBRÁVEL nunca importar `@theokit/sdk*`
 * direto. Quando `@theokit/agents/auth` exportava 1 valor contra os 19 símbolos do SDK,
 * **reimplementar era a única saída legal** — e ele reescreveu seis nomes idênticos, ~120 linhas de
 * mecânica de credencial duplicada. A lacuna era da camada; a duplicação foi só o sintoma.
 *
 * ## O contrato: DECISÃO por símbolo, não cobertura
 *
 * Exigir que a camada repasse TUDO deixaria este gate permanentemente vermelho — há símbolos que ela
 * deliberadamente não quer expor (detalhe interno do device flow), e há um caso em que repassar seria
 * ATIVAMENTE ERRADO: `resolveCredential` existe nos dois lados com contratos diferentes.
 *
 * Então o gate não exige cobertura. Ele exige **decisão escrita**: cada símbolo do SDK é `'coberto'`
 * ou `{ fora: '<razão>' }`. Um símbolo novo sem decisão quebra o CI — que é barato — em vez de sumir
 * em silêncio, que foi o que custou 24 KB.
 *
 * O desenho vem de `check-package-direction.mjs`, o guard irmão, e da lição escrita no cabeçalho dele:
 * *"a gate nobody can make green is a gate nobody reads"*.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Piso de não-vacuidade por subpath.
 *
 * Se a enumeração devolver menos que isto, o `import()` provavelmente falhou (build quebrado, subpath
 * fora do campo `exports`, versão incompatível) e a lista veio vazia — fazendo "0 símbolos sem
 * decisão" virar trivialmente verdadeiro. Um gate que não consegue ler nada NÃO está aprovando nada.
 */
const PISO_DE_SIMBOLOS = { auth: 15 }

/**
 * A decisão, por símbolo do SDK. `'coberto'` = a camada repassa. `{ fora }` = deliberadamente não, com
 * a razão escrita — a razão é o que separa uma decisão de uma omissão.
 */
const DECISIONS = {
  auth: {
    // — a mecânica de store: pass-through puro (M73). `reexportado` é VERIFICADO contra o entry.
    authFilePath: 'reexportado',
    CredentialError: 'reexportado',
    credentialHome: 'reexportado',
    readAuthFile: 'reexportado',
    readStoredOAuth: 'reexportado',
    writeCredential: 'reexportado',
    ResolveCredentialOptions: 'reexportado',

    // — o ciclo de vida OAuth: alcançável pela classe `AuthProvider`, que segura config+store. NÃO é
    // re-export, e o token diferente existe para o gate não afirmar o que não checou.
    ensureFreshCredential: 'via-AuthProvider',
    openaiDeviceLogin: 'via-AuthProvider',
    persistOAuthTokens: 'via-AuthProvider',

    // — fora de escopo, com razão
    resolveCredential: {
      fora:
        'o SDK e o consumidor têm funções DIFERENTES com este nome (sync vs async, lança vs undefined, ' +
        'lê env vs não lê, infere provider vs recusa). O próprio SDK declara que a precedência de env, ' +
        'a inferência por prefixo e o provider declarado são app policy do consumidor. Expor os dois no ' +
        'mesmo escopo seria convite a importar o errado, com falha silenciosa.',
    },
    deviceLogin: {
      fora: 'primitivo genérico do device flow; a camada expõe `openaiDeviceLogin`, que é a rota real',
    },
    requestDeviceCode: {
      fora: 'etapa interna do device flow, orquestrada por `openaiDeviceLogin`',
    },
    requestOpenAIUsercode: { fora: 'idem — etapa interna, não superfície de consumidor' },
    pollDeviceToken: { fora: 'idem — o polling é detalhe de `openaiDeviceLogin`' },
    exchangeCode: { fora: 'etapa interna do authorization-code flow' },
    refreshOAuthTokens: {
      fora: 'a camada expõe `AuthProvider.ensureFresh`, que decide QUANDO refrescar',
    },
    parseJwtClaims: { fora: 'utilitário de parsing sem relação com o contrato de auth da camada' },
    extractAccountId: { fora: 'idem — detalhe de leitura de claim' },
  },
}

const problems = []

for (const [subpath, decisoes] of Object.entries(DECISIONS)) {
  const dts = join(ROOT, 'node_modules/@theokit/sdk/dist', subpath, 'index.d.ts')
  let source
  try {
    source = readFileSync(dts, 'utf8')
  } catch (err) {
    problems.push(
      `NÃO CONSEGUI LER a superfície de \`@theokit/sdk/${subpath}\` (${dts}): ${err.message}\n` +
        '  Isto NÃO é aprovação: sem ler os exports do SDK o gate não tem como comparar nada.',
    )
    continue
  }

  // Três formas emitidas, porque o `.d.ts` usa as três e ler só uma deixa símbolo novo passar SEM
  // decisão — silenciosamente, que é exatamente o defeito que este gate existe para impedir. O piso de
  // não-vacuidade não protege disso: com o bloco `export { … }` intacto a contagem segue acima do piso
  // e só o símbolo novo some.
  const blockNames = [...source.matchAll(/export\s*\{([^}]*)\}/g)]
    .flatMap((m) => m[1].split(','))
    // `a as b` re-exporta sob o nome `b` — é ELE que o consumidor enxerga.
    .map((t) =>
      t
        .replace(/\btype\b/, '')
        .split(/\bas\b/)
        .pop()
        .trim(),
    )
  const declaredNames = [
    ...source.matchAll(/export\s+declare\s+(?:function|class|const|let|var)\s+(\w+)/g),
  ].map((m) => m[1])
  const declaredTypes = [...source.matchAll(/export\s+(?:type|interface)\s+(\w+)/g)].map(
    (m) => m[1],
  )
  const exports = [
    ...new Set(
      [...blockNames, ...declaredNames, ...declaredTypes].filter((n) => /^[A-Za-z_]\w*$/.test(n)),
    ),
  ]

  // O que o entry da camada REALMENTE re-exporta. Sem isto, `reexportado` é uma afirmação que o gate
  // nunca conferiu: remover um símbolo de `auth-entry.ts` deixava tudo verde (review F-02).
  const entry = readFileSync(join(ROOT, `packages/agents/src/${subpath}-entry.ts`), 'utf8')
  const reExported = new Set(
    [...entry.matchAll(/export\s*(?:type\s*)?\{([^}]*)\}\s*from/g)]
      .flatMap((m) => m[1].split(','))
      .map((t) =>
        t
          .replace(/\btype\b/, '')
          .split(/\bas\b/)
          .pop()
          .trim(),
      )
      .filter(Boolean),
  )

  // ÂNCORA DE NÃO-VACUIDADE. Sem ela, uma enumeração quebrada devolve [] e o laço abaixo não roda:
  // "0 símbolos sem decisão" fica trivialmente verdadeiro e o gate certifica sem ter olhado nada.
  const piso = PISO_DE_SIMBOLOS[subpath] ?? 1
  if (exports.length < piso) {
    problems.push(
      `A enumeração de \`@theokit/sdk/${subpath}\` achou ${exports.length} símbolos (piso ${piso}).\n` +
        '  A leitura dos exports provavelmente quebrou — e um gate que não acha nada passa por VACUIDADE,\n' +
        '  não por paridade. Conserte a enumeração antes de confiar neste resultado.',
    )
    continue
  }

  for (const nome of exports) {
    const d = decisoes[nome]
    if (d === undefined) {
      problems.push(
        `\`${nome}\` é exportado por \`@theokit/sdk/${subpath}\` e NÃO tem decisão registrada.\n` +
          `  A camada nunca deve REDUZIR a superfície do SDK: um símbolo que ela não repassa fica\n` +
          '  inalcançável para quem não pode importar o SDK direto — e a saída dele passa a ser\n' +
          '  reimplementar. Escreva a decisão em scripts/check-auth-parity.mjs:\n' +
          `    ${nome}: 'coberto'                              // e re-exporte em src/${subpath}-entry.ts\n` +
          `    ${nome}: { fora: '<por que não atravessa>' }    // decisão explícita, não omissão`,
      )
      continue
    }
    if (d === 'reexportado' && !reExported.has(nome)) {
      problems.push(
        `\`${nome}\` está declarado como \`'reexportado'\` mas \`src/${subpath}-entry.ts\` NÃO o re-exporta.\n` +
          '  A decisão dizia que ele atravessa, e ele não atravessa — a lista virou afirmação não conferida.\n' +
          `  Ou acrescente o símbolo ao re-export, ou mude a decisão para \`'via-AuthProvider'\` / \`{ fora }\`.`,
      )
      continue
    }
    if (typeof d === 'object' && !String(d.fora ?? '').trim()) {
      problems.push(
        `\`${nome}\` está marcado como fora de escopo SEM razão escrita.\n` +
          '  Allowlist sem razão vira lista morta que ninguém revisa — escreva por que ele não atravessa.',
      )
    }
  }

  for (const nome of Object.keys(decisoes)) {
    if (!exports.includes(nome)) {
      problems.push(
        `\`${nome}\` tem decisão registrada mas o SDK NÃO o exporta mais.\n` +
          '  Entrada morta engana quem lê a lista — remova.',
      )
    }
  }
}

if (problems.length > 0) {
  console.error('\n✗ paridade de superfície SDK → camada\n')
  for (const p of problems) console.error(`  • ${p}\n`)
  process.exit(1)
}

console.log('✓ paridade de superfície: todo símbolo do SDK tem decisão escrita')
