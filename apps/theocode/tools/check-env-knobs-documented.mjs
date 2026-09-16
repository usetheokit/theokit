#!/usr/bin/env node
/**
 * Every environment variable an operator can set must be findable in the README.
 *
 * The sibling gate, `check-config-documented.mjs`, enforces this for `settings.json` keys and reads
 * `CONFIG_SCHEMA_KEYS` to do it. An environment knob is outside its reach entirely, so it reported
 * "all 13 config keys are documented" while two knobs that change real behaviour were discoverable
 * only by reading the source that reads them:
 *
 *   THEOKIT_SEARCH_API_URL   decides whether web_search is declared to the model AT ALL. Unset or
 *                            misspelt, it takes an empty default and the capability disappears —
 *                            the tool is not registered, its approval entry is omitted, and nothing
 *                            says so.
 *   THEOCODE_DIAGNOSTICS     the documented recovery path for a masked turn failure. `turn-error.ts`
 *                            records that when a turn failed the real cause was a RateLimitError and
 *                            "the ONLY way to see it was THEOCODE_DIAGNOSTICS=stderr — an environment
 *                            variable the failure message does not mention."
 *
 * A knob that exists and cannot be discovered is worse than one that does not exist: the operator
 * hits the default, has no way to learn there is an alternative, and concludes the behaviour is
 * fixed.
 *
 * ## What this gate can and cannot see
 *
 * It matches `env.NAME` and `env['NAME']` in source text. A read through destructuring, a computed
 * key, or a name assembled at runtime is invisible to it — the same limit `knip.jsonc` states about
 * runtime-computed specifiers. So a clean run means "no read of the two common shapes is
 * undocumented", never "every knob is documented". Stating the limit is the point: a gate believed
 * to be exhaustive is one nobody re-checks by hand.
 */
import { existsSync, readFileSync } from 'node:fs'
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const REGISTRY = 'packages/agent/src/config/env-knobs.ts'
const README = 'README.md'
const ROOTS = ['packages/agent/src', 'packages/cli/src', 'packages/tui/src', 'packages/shared/src']

/**
 * Names read from the environment that are NOT this product's knobs, with the reason.
 *
 * The reason is mandatory — `undocumentedKnobs` refuses an empty one — because a silent opt-out is
 * precisely the defect being prevented. An exemption that says nothing is worth what an
 * undocumented knob is worth.
 */
export const NOT_OUR_KNOBS = new Map([
  [
    'CLAUDE_PROJECT_DIR',
    'set BY the harness for a hook it invokes, and read here to resolve that hook\'s cwd. It is an ' +
      'input from the environment we run inside, not a dial an operator of this product turns; ' +
      'documenting it as ours would invite someone to set it and change nothing.',
  ],
])

/**
 * Environment names READ in source, in the two shapes that occur here.
 *
 * Comments are stripped first, because a mention is not a read. `home-dir.ts` explains a decision
 * with the placeholder `env.X ?? default`, and matching prose reported `X` as an undocumented knob —
 * the false positive that makes a gate get switched off.
 */
export function envNamesRead(source) {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ')
  const names = new Set()
  for (const m of code.matchAll(/\benv\.([A-Z][A-Z0-9_]*)\b/g)) names.add(m[1])
  for (const m of code.matchAll(/\benv\[\s*['"]([A-Z][A-Z0-9_]*)['"]\s*\]/g)) names.add(m[1])
  return [...names].sort()
}

/** Every `.ts`/`.tsx` file under a root, excluding tests — a test may name a knob it does not own. */
export function sourceFiles(roots = ROOTS, { read = readdirSync, stat = statSync } = {}) {
  const out = []
  const walk = (dir) => {
    for (const name of read(dir)) {
      const path = join(dir, name)
      if (stat(path).isDirectory()) walk(path)
      else if (/\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path)) out.push(path)
    }
  }
  for (const root of roots) if (existsSync(root)) walk(root)
  return out
}

/**
 * A knob is undocumented when the README does not name it.
 *
 * Registry membership is checked and reported separately rather than accepted as documentation:
 * `ENV_KNOBS` is a source list that only a contributor reads. Both are required, and the README is
 * the one that answers the operator's question.
 */
export function undocumentedKnobs(names, registry, readme, exempt = NOT_OUR_KNOBS) {
  return names.filter((n) => {
    const reason = exempt.get(n)
    if (typeof reason === 'string' && reason.trim().length > 0) return false
    return !readme.includes(n) || !registry.includes(`'${n}'`)
  })
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const quiet = process.argv.includes('--quiet')
  const registry = readFileSync(REGISTRY, 'utf8')
  const readme = readFileSync(README, 'utf8')
  const files = sourceFiles()
  const names = [
    ...new Set(files.flatMap((f) => envNamesRead(readFileSync(f, 'utf8')))),
  ].sort()
  const loose = undocumentedKnobs(names, registry, readme)
  if (loose.length > 0) {
    process.stderr.write(
      `${String(loose.length)} environment knob(s) an operator can set are not both registered in ` +
        `${REGISTRY} and named in ${README}:\n` +
        loose.map((n) => `  ${n}\n`).join('') +
        'A knob that cannot be discovered reads as a behaviour that cannot be changed.\n' +
        `If one is not ours to document, add it to NOT_OUR_KNOBS with the reason.\n`,
    )
    process.exit(1)
  }
  if (!quiet) {
    process.stdout.write(
      `env knobs: ${String(names.length)} name(s) read across ${String(files.length)} source file(s), ` +
        `every one registered and documented\n`,
    )
  }
}
