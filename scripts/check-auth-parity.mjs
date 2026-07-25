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
const DECISOES = {
  auth: {
    // — a mecânica de store: pass-through puro (M73)
    authFilePath: 'coberto',
    CredentialError: 'coberto',
    credentialHome: 'coberto',
    readAuthFile: 'coberto',
    readStoredOAuth: 'coberto',
    writeCredential: 'coberto',
    ResolveCredentialOptions: 'coberto',

    // — o ciclo de vida OAuth: a camada expõe via `AuthProvider`, que segura config+store
    ensureFreshCredential: 'coberto',
    openaiDeviceLogin: 'coberto',
    persistOAuthTokens: 'coberto',

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

const problemas = []

for (const [subpath, decisoes] of Object.entries(DECISOES)) {
  const dts = join(ROOT, 'node_modules/@theokit/sdk/dist', subpath, 'index.d.ts')
  let fonte
  try {
    fonte = readFileSync(dts, 'utf8')
  } catch (err) {
    problemas.push(
      `NÃO CONSEGUI LER a superfície de \`@theokit/sdk/${subpath}\` (${dts}): ${err.message}\n` +
        '  Isto NÃO é aprovação: sem ler os exports do SDK o gate não tem como comparar nada.',
    )
    continue
  }

  const exports = [
    ...new Set(
      [...fonte.matchAll(/export\s*\{([^}]*)\}/g)]
        .flatMap((m) => m[1].split(','))
        .map((s) => s.replace(/\btype\b/, '').trim())
        .filter((s) => /^[A-Za-z_]\w*$/.test(s)),
    ),
  ]

  // ÂNCORA DE NÃO-VACUIDADE. Sem ela, uma enumeração quebrada devolve [] e o laço abaixo não roda:
  // "0 símbolos sem decisão" fica trivialmente verdadeiro e o gate certifica sem ter olhado nada.
  const piso = PISO_DE_SIMBOLOS[subpath] ?? 1
  if (exports.length < piso) {
    problemas.push(
      `A enumeração de \`@theokit/sdk/${subpath}\` achou ${exports.length} símbolos (piso ${piso}).\n` +
        '  A leitura dos exports provavelmente quebrou — e um gate que não acha nada passa por VACUIDADE,\n' +
        '  não por paridade. Conserte a enumeração antes de confiar neste resultado.',
    )
    continue
  }

  for (const nome of exports) {
    const d = decisoes[nome]
    if (d === undefined) {
      problemas.push(
        `\`${nome}\` é exportado por \`@theokit/sdk/${subpath}\` e NÃO tem decisão registrada.\n` +
          `  A camada nunca deve REDUZIR a superfície do SDK: um símbolo que ela não repassa fica\n` +
          '  inalcançável para quem não pode importar o SDK direto — e a saída dele passa a ser\n' +
          '  reimplementar. Escreva a decisão em scripts/check-auth-parity.mjs:\n' +
          `    ${nome}: 'coberto'                              // e re-exporte em src/${subpath}-entry.ts\n` +
          `    ${nome}: { fora: '<por que não atravessa>' }    // decisão explícita, não omissão`,
      )
      continue
    }
    if (typeof d === 'object' && !String(d.fora ?? '').trim()) {
      problemas.push(
        `\`${nome}\` está marcado como fora de escopo SEM razão escrita.\n` +
          '  Allowlist sem razão vira lista morta que ninguém revisa — escreva por que ele não atravessa.',
      )
    }
  }

  for (const nome of Object.keys(decisoes)) {
    if (!exports.includes(nome)) {
      problemas.push(
        `\`${nome}\` tem decisão registrada mas o SDK NÃO o exporta mais.\n` +
          '  Entrada morta engana quem lê a lista — remova.',
      )
    }
  }
}

if (problemas.length > 0) {
  console.error('\n✗ paridade de superfície SDK → camada\n')
  for (const p of problemas) console.error(`  • ${p}\n`)
  process.exit(1)
}

console.log('✓ paridade de superfície: todo símbolo do SDK tem decisão escrita')
