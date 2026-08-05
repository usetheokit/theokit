#!/usr/bin/env node
/**
 * Notices a wire variant that appeared in `ai` and that our mirror does not model.
 *
 * The mirror covers only the subset TheoKit speaks (plan D2). That is deliberate — the other
 * variants would be exports with no consumer. The cost of the choice is that a NEW upstream variant
 * would be silently discarded on read, so something has to watch for it. This is that something,
 * built on the same shape as `check-sandbox-parity.mjs`.
 *
 * A variant present upstream and absent here is a WARNING, not a failure: not every ai-sdk frame
 * concerns TheoKit, and a gate that fails on every upstream addition is a gate people route around.
 * What IS a failure is the reverse — a variant we claim to speak that upstream does not have, which
 * means the mirror invented something nobody on the other side understands.
 *
 * Without `ai` installed the gate reports that it could not measure and exits non-zero. Reporting
 * success without an oracle is exactly the lie this plan exists to avoid.
 *
 * ## How it reads the upstream set, and the honest limit of that
 *
 * `ai` exports `uiMessageChunkSchema` as a FUNCTION (a lazy schema), so zod introspection has
 * nothing to walk. The discriminants are therefore extracted from the `UIMessageChunk` union in the
 * shipped `.d.ts` — textual, and stated as such: a refactor of that declaration's formatting would
 * make this gate under-report. It is checked against a floor (the union must yield a plausible
 * number of variants) so a parse that silently matched nothing fails instead of passing.
 */
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'

import { WIRE_CHUNK_TYPES } from '../packages/presenter/dist/wire/index.js'

/** Below this, assume the textual extraction broke rather than that `ai` shrank. */
const PLAUSIBILITY_FLOOR = 10

function upstreamVariants() {
  const require = createRequire(import.meta.url)
  let dts
  try {
    dts = require.resolve('ai/package.json').replace(/package\.json$/, 'dist/index.d.ts')
  } catch {
    return null
  }
  let text
  try {
    text = readFileSync(dts, 'utf8')
  } catch {
    return null
  }
  const start = text.indexOf('type UIMessageChunk<')
  if (start === -1) return null
  const end = text.indexOf('\n};', start)
  const union = text.slice(start, end === -1 ? undefined : end)
  const out = new Set()
  for (const m of union.matchAll(/type: '([a-z][a-z0-9-]*)'/g)) out.add(m[1])
  return out
}

const upstream = upstreamVariants()

if (upstream === null || upstream.size < PLAUSIBILITY_FLOOR) {
  console.error(
    'check-wire-parity: NÃO MEDIDO — não foi possível enumerar a união do `ai`' +
      (upstream ? ` (só ${upstream.size} variantes, abaixo do piso ${PLAUSIBILITY_FLOOR}).` : '.') +
      '\n  O oráculo é o que torna o espelho verificável; sem ele este gate não tem o que comparar.' +
      '\n  Instale as devDependencies, ou conserte a extração se a declaração do `ai` mudou de forma.',
  )
  process.exit(1)
}

const ours = new Set(WIRE_CHUNK_TYPES)
const invented = [...ours].filter((t) => !upstream.has(t)).sort()
const missing = [...upstream].filter((t) => !ours.has(t)).sort()

if (invented.length > 0) {
  console.error('\ncheck-wire-parity: FALHA — variantes que declaramos e o `ai` não tem:\n')
  for (const t of invented) console.error(`  - ${t}`)
  console.error('\nUma variante inventada não é entendida por ninguém do outro lado do wire.\n')
  process.exit(1)
}

console.log(
  `check-wire-parity: OK — ${ours.size} variantes espelhadas, todas presentes no \`ai\` ` +
    `(${upstream.size} upstream).`,
)
if (missing.length > 0) {
  console.log(
    `\ncheck-wire-parity: AVISO — ${missing.length} variante(s) do \`ai\` fora do espelho.\n` +
      'Esperado: a D2 espelha só o subconjunto que o TheoKit fala. Vira problema no dia em que\n' +
      'o presenter ou o bridge passar a emitir uma delas — aí ela precisa entrar no schema.\n',
  )
  for (const t of missing) console.log(`  - ${t}`)
}
