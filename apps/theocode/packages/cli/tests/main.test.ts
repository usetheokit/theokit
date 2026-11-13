/**
 * B-026 — no executable statement may sit between import declarations.
 *
 * `loadProjectEnv()` and `ensureAuthHome()` used to be written between the imports of `main.ts`,
 * which READS as ordered setup and is not: ESM hoists every import declaration and evaluates all of
 * them before the first statement runs. Every command module was therefore loaded before the
 * project `.env` reached `process.env`.
 *
 * The user-visible half (B-023 finding #20) is that `process.loadEnvFile()` reads `.env` from the
 * CWD AT CALL TIME, while `-C/--cd` chdir'd later inside `main` — so `theocode -C other/ …` loaded
 * the `.env` of the directory the user was leaving.
 *
 * WHY THIS TEST IS STRUCTURAL, stated rather than hidden: an end-to-end demonstration needs a `.env`
 * whose effect is observable from a cheap command. The obvious candidate — `THEOKIT_HOME`, which
 * relocates the session store — is a SOVEREIGN key (`project-env.ts:2`), deliberately not
 * overridable from a project `.env` so a repository cannot redirect where sessions and credentials
 * live. A first attempt used it and produced identical output before and after the fix; that was
 * correct behaviour, not evidence, and the test was invalid. No other non-sovereign variable
 * changes the output of a command that runs without a model call.
 *
 * So this asserts the shape that made the defect possible, which is the thing that can regress by
 * someone adding one more "bootstrap" line in the import block.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const SOURCE = readFileSync(fileURLToPath(new URL('../src/main.ts', import.meta.url)), 'utf8')

/** Line numbers of top-level `import ... from '../src/...'` declarations. */
function importLines(src: string): number[] {
  return src
    .split('\n')
    .map((line, i) => (/^import\s.*\sfrom\s/.test(line) ? i + 1 : 0))
    .filter((n) => n > 0)
}

/** Line numbers of top-level statements: not blank, not a comment, not an import, not indented. */
function topLevelStatementLines(src: string): number[] {
  return src
    .split('\n')
    .map((line, i) => {
      const t = line.trim()
      if (t === '' || t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return 0
      if (/^import\s/.test(line) || /^export\s/.test(line)) return 0
      if (line !== line.trimStart()) return 0
      if (/^(function|async function|const|let|class|interface|type|\})/.test(t)) return 0
      return i + 1
    })
    .filter((n) => n > 0)
}

describe('B-026 — the bootstrap does not hide inside the import block', () => {
  it('test_no_statement_runs_between_import_declarations', () => {
    const imports = importLines(SOURCE)
    const lastImport = Math.max(...imports)
    const early = topLevelStatementLines(SOURCE).filter((n) => n < lastImport)

    expect(
      early,
      `main.ts line(s) ${early.join(', ')} sit between imports and read as ordered setup. ESM ` +
        'hoists every import, so they run AFTER all of them — the order the source implies is not ' +
        'the order achieved.',
    ).toEqual([])
  })

  it('test_the_source_actually_has_imports_and_statements', () => {
    // Anti-vacuity floor: an empty match set would satisfy the assertion above for free.
    expect(importLines(SOURCE).length).toBeGreaterThan(5)
    expect(topLevelStatementLines(SOURCE).length).toBeGreaterThan(0)
  })

  it('test_env_is_loaded_after_the_working_directory_is_selected', () => {
    // `.env` is read from the CWD at call time, so the bootstrap must follow `chdir`. Structural for
    // the reason in the file docstring — the honest alternative was no check at all.
    const chdir = SOURCE.indexOf('process.chdir(')
    const boot = SOURCE.indexOf('bootstrap()', SOURCE.indexOf('function bootstrap') + 20)

    expect(chdir, 'main.ts no longer chdirs for -C/--cd').toBeGreaterThan(0)
    expect(boot, 'main.ts no longer calls bootstrap()').toBeGreaterThan(0)
    expect(
      boot,
      'bootstrap() runs before chdir, so `.env` comes from the directory being left',
    ).toBeGreaterThan(chdir)
  })
})
