#!/usr/bin/env node
/**
 * `npm run lint`, mas num processo por grupo — agent-builder#119.
 *
 * ## O que foi medido
 *
 * `eslint . --max-warnings=0` não terminava: OOM com heap padrão, OOM com 8 GB, e com 12 GB parava
 * de estourar mas não convergia — morto em 15 min com RSS de ~10,5 GB numa máquina de 15,6 GB. O
 * lint da camada ficou **sem veredito** por duas rodadas de revisão, e três erros reais chegaram a
 * `develop` porque só execução escopada (`npx eslint <paths>`) dava resposta.
 *
 * Medido por grupo, cada um **termina sozinho**:
 *
 * | Grupo | Tempo | Pico RSS |
 * |---|---|---|
 * | `packages/presenter` | 12 s | 0,85 GB |
 * | `tests` | 58 s | 1,6 GB |
 * | `packages/agents` | 102 s | 1,6 GB |
 * | `packages/http` | 106 s | 2,6 GB |
 * | `packages/theo` | 206 s | 2,9 GB |
 *
 * Soma dos picos ≈ **9,6 GB** — que é o RSS observado. A causa não é um arquivo patológico nem uma
 * regra lenta: é `projectService: true` sobre um monorepo **num processo só**. O serviço mantém o
 * programa TypeScript de cada pacote vivo simultaneamente, e nada é liberado até o fim.
 *
 * Um processo por grupo faz o sistema operacional liberar cada programa ao sair. O teto passa a ser
 * o **maior** grupo (2,9 GB), não a **soma**.
 *
 * ## Por que não `pnpm -r exec eslint`
 *
 * Porque ele varre só o que é workspace, e `tests/` (573 arquivos — o segundo maior grupo) e
 * `scripts/` moram na raiz. Um lint que cobre menos que o `eslint .` que substitui não é o mesmo
 * gate; é um gate menor com o mesmo nome.
 *
 * ## A raiz é DERIVADA, e há piso anti-vacuidade
 *
 * Os grupos saem do **índice do git** cruzado com o `isPathIgnored` do próprio ESLint — nunca de uma
 * lista escrita à mão. Uma lista à mão falharia por **omissão**: um pacote novo simplesmente não
 * seria varrido, e ninguém notaria, que é como o gate morre em silêncio.
 *
 * E derivar não basta: antes de rodar qualquer coisa, este script confere que **todo** arquivo que o
 * ESLint linta cai em **algum** grupo. Se sobrar um, ele falha alto em vez de varrer 99% e reportar
 * verde — uma varredura que devolve menos do que devia passa igual a uma completa.
 */

import { spawnSync } from 'node:child_process'
import process from 'node:process'

import { ESLint } from 'eslint'

const EXTENSIONS = ['*.ts', '*.tsx', '*.mts', '*.cts', '*.js', '*.mjs', '*.cjs']

/** Todo arquivo versionado que o ESLint realmente lintaria — o índice do git é a fonte. */
async function lintableFiles() {
  // `git` pelo PATH é o contrato deste script: ele roda como `npm run lint`, no repositório, com o
  // mesmo `git` que o desenvolvedor usa. Caminho absoluto quebraria em macOS/nix e não fecha ameaça
  // nenhuma — quem controla o PATH de um lint local já controla o `node` que o executa.
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- ver acima
  const saida = spawnSync('git', ['ls-files', ...EXTENSIONS], {
    encoding: 'utf8',
    maxBuffer: 1 << 28,
  })
  if (saida.status !== 0) throw new Error(`git ls-files falhou: ${saida.stderr}`)
  const eslint = new ESLint()
  const todos = saida.stdout.trim().split('\n').filter(Boolean)
  const lintable = []
  for (const f of todos) if (!(await eslint.isPathIgnored(f))) lintable.push(f)
  return lintable
}

/**
 * O grupo de um arquivo: `packages/<nome>` para pacote, o primeiro segmento para o resto, e `.` para
 * arquivo de raiz (`eslint.config.js`, `vitest.config.ts`, …).
 */
function groupOf(file) {
  const parts = file.split('/')
  if (parts.length === 1) return '.'
  if (parts[0] === 'packages' && parts.length > 2) return `packages/${parts[1]}`
  return parts[0]
}

function lintar(grupo, argsExtras) {
  // Arquivo de raiz vira lista explícita: `eslint .` seria justamente o processo único que este
  // script existe para não rodar.
  const target = grupo === '.' ? rootGroups : [grupo]
  const start = Date.now()
  // Mesmo racional do `git` acima: é o `npx` do projeto que precisa rodar, e ele vem do PATH que o
  // `npm run` já montou.
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- ver acima
  const r = spawnSync('npx', ['eslint', ...target, ...argsExtras], { stdio: 'inherit' })
  return { grupo, segundos: (Date.now() - start) / 1000, ok: r.status === 0 }
}

let rootGroups = []

async function main() {
  const argsExtras = process.argv.slice(2)
  if (!argsExtras.includes('--fix')) argsExtras.push('--max-warnings=0')

  const fileList = await lintableFiles()
  if (fileList.length === 0) {
    console.error('lint: nenhum arquivo lintável — o filtro está errado, não o repositório')
    process.exit(2)
  }

  const byGroup = new Map()
  for (const f of fileList) {
    const g = groupOf(f)
    if (!byGroup.has(g)) byGroup.set(g, [])
    byGroup.get(g).push(f)
  }
  rootGroups = byGroup.get('.') ?? []

  // Piso anti-vacuidade: a cobertura tem de fechar. Não fecha → falha alto.
  const covered = [...byGroup.values()].reduce((n, v) => n + v.length, 0)
  if (covered !== fileList.length) {
    console.error(`lint: coverage does not close — ${covered} of ${fileList.length}`)
    process.exit(2)
  }

  // Maior grupo primeiro: se algo vai estourar memória, que estoure em 3 min e não em 8.
  const groups = [...byGroup.entries()].sort((a, b) => b[1].length - a[1].length).map(([g]) => g)
  console.error(`lint: ${fileList.length} files in ${groups.length} groups, one process each`)

  const results = []
  for (const g of groups) results.push(lintar(g, argsExtras))

  console.error('\n— resumo —')
  for (const r of results) {
    const n = byGroup.get(r.grupo).length
    console.error(
      `${r.ok ? 'ok  ' : 'FALHA'} ${r.segundos.toFixed(1).padStart(7)}s ${String(n).padStart(5)} arq  ${r.grupo}`,
    )
  }
  const failures = results.filter((r) => !r.ok)
  console.error(
    failures.length === 0
      ? `lint: green across ${groups.length} groups`
      : `lint: ${failures.length} group(s) with findings`,
  )
  process.exit(failures.length === 0 ? 0 : 1)
}

await main()
