/**
 * M90 — ferramenta de AUTORIA, de uso único: enumera os exports de um subpath-alias e imprime o bloco
 * de re-export nomeado para colar no `*-entry.ts`.
 *
 * ## Por que gerar, e por que NÃO no build
 *
 * São 172 símbolos nos cinco subpaths de infra. Escrever à mão erra, e um erro aqui é um símbolo que
 * some da superfície pública sem nada acusar. Gerar **no build**, porém, devolveria o problema: um
 * `export *` executado por script continua sendo `export *`, e a decisão volta a ser implícita. A
 * lista é código-fonte commitado, revisável em diff — é metade do valor.
 *
 * Precedente de ferramenta de uso único no corpus: a atribuição por `git blame` do M72, cujo
 * `adr-governance.md § 6` diz explicitamente "do not reuse this procedure as a standing tool".
 *
 *   npx tsx scripts/gerar-reexports.mts [--json]
 */
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import ts from 'typescript'

const AQUI = dirname(fileURLToPath(import.meta.url))
const RAIZ = join(AQUI, '..')

/** Os cinco subpaths de infra: nome do entry → especificador da fonte. */
export const SUBPATHS_DE_INFRA: Readonly<Record<string, string>> = {
  tools: '@theokit/sdk-tools',
  sandbox: '@theokit/sdk/sandbox',
  persistence: '@theokit/sdk/persistence',
  pty: '@theokit/sdk-pty',
  interactive: '@theokit/sdk/interactive',
}

export interface Superficie {
  /** Símbolos que existem em runtime — vão em `export { … }`. */
  readonly valores: readonly string[]
  /** Símbolos só-de-tipo — vão em `export type { … }`, exigido por `isolatedModules`. */
  readonly tipos: readonly string[]
}

/**
 * Enumera os exports de um especificador, classificando valor vs tipo-somente.
 *
 * Resolve a partir de `src/index.ts` — o mesmo ponto de vista do build, para não divergir do que o
 * bundler resolve.
 */
/**
 * Enumera os exports de um especificador, classificando valor vs tipo-somente.
 *
 * O **conjunto completo** vem do compilador (`getExportsOfModule`), porque só ele enxerga os
 * só-de-tipo. A **classificação** vem do runtime, e isso não é preguiça: medido, `SymbolFlags` mente
 * nos dois sentidos aqui. A máscara larga (`SymbolFlags.Value`) marcou `AtomicWriteJsonOptions`,
 * `FileLockOptions` e `WalApplyResult` como valor — são `interface`. A máscara estrita
 * (`Function|Class|Variable|Enum|Method`) perdeu seis funções reais de `/persistence`, porque
 * `atomicWriteText` resolve para um símbolo `Transient|Property` (`flags = 33554436`), e não para uma
 * declaração de função: o alias atravessa um objeto de namespace no `.d.ts` da fonte.
 *
 * O namespace ESM é a verdade sobre o que `export { … }` pode carregar — pôr um só-tipo ali reprova
 * sob `isolatedModules`, e é exatamente esse erro que a classificação precisa não cometer.
 *
 * Resolve a partir de `src/index.ts` — o mesmo ponto de vista do build, para não divergir do bundler.
 */
export async function enumerarSuperficie(especificador: string): Promise<Superficie> {
  const host = ts.createCompilerHost({})
  const res = ts.resolveModuleName(
    especificador,
    join(RAIZ, 'src', 'index.ts'),
    { moduleResolution: ts.ModuleResolutionKind.Bundler },
    host,
  )
  const arquivo = res.resolvedModule?.resolvedFileName
  if (arquivo === undefined) throw new Error(`não resolveu: ${especificador}`)

  const prog = ts.createProgram([arquivo], {
    noEmit: true,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    skipLibCheck: true,
  })
  const sf = prog.getSourceFile(arquivo)
  if (sf === undefined) throw new Error(`sem source file: ${arquivo}`)
  const ck = prog.getTypeChecker()
  const mod = ck.getSymbolAtLocation(sf)
  if (mod === undefined) throw new Error(`sem símbolo de módulo: ${arquivo}`)
  const todos = ck.getExportsOfModule(mod).map((s) => s.getName())

  const emRuntime = new Set(Object.keys((await import(especificador)) as object))
  // `localeCompare` e não o `sort()` nu: a ordem precisa ser estável entre máquinas, senão o snapshot
  // da superfície vira diff espúrio por locale.
  const alfabetica = (a: string, b: string): number => a.localeCompare(b)
  const valores = todos.filter((n) => emRuntime.has(n)).sort(alfabetica)
  const tipos = todos.filter((n) => !emRuntime.has(n)).sort(alfabetica)

  // Piso anti-vacuidade: um `todos` vazio significaria que a resolução quebrou, e o entry gerado sairia
  // vazio — reduzindo a superfície pública a zero em silêncio. É o risco nº 1 do plano.
  if (todos.length === 0) throw new Error(`superfície vazia para ${especificador} — resolução quebrou`)
  return { valores, tipos }
}

/** O bloco pronto para colar no `*-entry.ts`. */
export function renderizarBloco(especificador: string, s: Superficie): string {
  const lista = (nomes: readonly string[]) => nomes.map((n) => `  ${n},`).join('\n')
  const partes: string[] = []
  if (s.valores.length > 0) partes.push(`export {\n${lista(s.valores)}\n} from '${especificador}'`)
  if (s.tipos.length > 0) partes.push(`export type {\n${lista(s.tipos)}\n} from '${especificador}'`)
  return partes.join('\n')
}

// Rodado como CLI (`npx tsx scripts/gerar-reexports.mts [--json]`), nunca importado por código de
// produção — é ferramenta de autoria. As funções acima são exportadas para que o teste de superfície
// use a MESMA enumeração, em vez de reimplementá-la (a duplicação que o M78 chamou de "duas listas
// que precisam ficar em sincronia").
//
// A guarda de main não é cerimônia: sem ela, `import` deste módulo pelo teste EXECUTA o CLI e despeja
// 172 nomes na stdout da suíte. Foi o que aconteceu na primeira versão.
// `process.argv[1]` é tipado `string` (sem `noUncheckedIndexedAccess`), então checar `undefined` é
// código morto que o lint reprova — em Node ele só falta em `-e`, e aí não há arquivo para comparar.
const invocadoComoCli = pathToFileURL(process.argv[1]).href === import.meta.url

if (invocadoComoCli) {
  const medidas: [sub: string, spec: string, superficie: Superficie][] = []
  for (const [sub, spec] of Object.entries(SUBPATHS_DE_INFRA)) {
    medidas.push([sub, spec, await enumerarSuperficie(spec)])
  }
  if (process.argv.includes('--json')) {
    process.stdout.write(
      JSON.stringify(Object.fromEntries(medidas.map(([sub, , s]) => [sub, s])), null, 2) + '\n',
    )
  } else {
    for (const [sub, spec, s] of medidas) {
      process.stdout.write(`\n// \u2550\u2550 ${sub}-entry.ts \u2550\u2550\n${renderizarBloco(spec, s)}\n`)
    }
  }
}
