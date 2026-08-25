import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

import { resolveSessionBaseDir } from '../../packages/theo/src/server/agent/mount-agent.js'

/**
 * usetheokit/theokit#395 — every conversation a TheoKit app serves is written to
 * `<app>/.data/agent-sessions/…/<sessionId>.jsonl`, and the scaffold's ignore
 * file listed `data/` — no leading dot. It matched nothing the framework writes.
 *
 * A developer who ran the app once and committed got the full transcript of
 * every turn into version control: prompts, answers, tool inputs, tool results.
 *
 * What made it survive is the comment above `resolveSessionBaseDir`, which
 * asserted the directory was git-ignored. Nobody checks a protection the source
 * says is already there.
 *
 * ## Why this test derives the path instead of writing it down
 *
 * A test asserting the literal `.data/` would pass the day someone moves the
 * transcripts and the ignore file does not follow — the same drift, one release
 * later. It asks the framework where it writes, and then asks whether the
 * template covers that answer.
 */

const TEMPLATE_ROOT = resolve(
  import.meta.dirname,
  '../../packages/create-theokit/templates/default',
)

/** The scaffold ships its ignore file as `_gitignore`; the CLI renames it on write. */
const ignoreLines = readFileSync(resolve(TEMPLATE_ROOT, '_gitignore'), 'utf-8')
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l.length > 0 && !l.startsWith('#'))

/** Does any pattern in the ignore file cover this app-relative path? */
function isIgnored(appRelativePath: string): boolean {
  return ignoreLines.some((pattern) => {
    const dir = pattern.replace(/\/$/u, '')
    return appRelativePath === dir || appRelativePath.startsWith(`${dir}/`)
  })
}

describe('the scaffold ignores what the framework writes into the app (#395)', () => {
  it('test_the_session_transcript_directory_is_ignored', () => {
    const base = resolveSessionBaseDir('/app')
    expect(base, 'the framework must tell us where it writes').toBeDefined()

    // '/app/.data/agent-sessions' -> '.data/agent-sessions'
    const appRelative = base!.slice('/app/'.length)

    expect(
      isIgnored(appRelative),
      `the framework writes conversation transcripts to ${appRelative} and the template does not ignore it`,
    ).toBe(true)
  })

  it('test_a_transcript_file_inside_it_is_ignored_too', () => {
    // The directory pattern must cover the files, not merely the folder entry.
    expect(isIgnored('.data/agent-sessions/projects/abc/session.jsonl')).toBe(true)
  })

  it('test_the_local_database_is_ignored', () => {
    // Same directory, and the reason `data/` looked plausible: the dev DB lives
    // at `.data/app.db` (see the Vite watcher's ignore list).
    expect(isIgnored('.data/app.db')).toBe(true)
  })

  it('test_the_build_output_is_still_ignored', () => {
    // Guard against a fix that rewrites the file and drops what worked.
    expect(isIgnored('.theokit/client/index.html')).toBe(true)
    expect(isIgnored('node_modules/theokit')).toBe(true)
  })
})

/**
 * The other two ignore lists, which do NOT read `.gitignore`.
 *
 * ESLint flat config takes `ignores` in `eslint.config.mjs`; Prettier reads `.prettierignore` and
 * little else. So the one file that already knows what the framework generates is consulted by
 * neither, and the three drift silently — which is what happened: a fresh app that had run
 * `pnpm build` reported ~1800 ESLint findings in generated `.d.ts` and failed `format:check` on
 * its own lockfile (usetheokit/theokit#444).
 *
 * Neither is a broken build. Both are worse in a quieter way: a developer who adds a real error of
 * their own cannot find it in the noise, and a gate nobody can act on stops being read.
 *
 * The invariant asserted here is narrow on purpose. It does not demand the three lists be
 * identical — `.env` belongs in `.gitignore` and nowhere else — only that the directories the
 * framework WRITES are ignored by all three.
 */
const GENERATED_BY_THE_FRAMEWORK = ['.theokit', 'dist', 'node_modules'] as const

const eslintConfig = readFileSync(resolve(TEMPLATE_ROOT, 'eslint.config.mjs'), 'utf-8')
const prettierIgnore = readFileSync(resolve(TEMPLATE_ROOT, '_prettierignore'), 'utf-8')
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l.length > 0 && !l.startsWith('#'))

// usetheokit/theokit#466 — the mirror of the rule below, and it has to be stated separately
// because it points the other way: `.theokit/` is ignored by every TOOL and must be loaded by the
// COMPILER. It holds the generated `client.d.ts`, so leaving it out of `include` means the typed
// client the framework generates never reaches the app that asked for it — and nothing fails,
// because an ambient module that is not loaded just leaves the import unresolved or `any`.
describe('what the framework writes is ignored by the tools AND loaded by the compiler', () => {
  it('the template tsconfig includes the directory the framework generates types into', () => {
    const tsconfig = JSON.parse(readFileSync(resolve(TEMPLATE_ROOT, 'tsconfig.json'), 'utf-8')) as {
      include: string[]
    }

    expect(tsconfig.include).toContain('.theokit/**/*.d.ts')
  })
})

describe('what the framework writes is ignored by every list, not just git', () => {
  it.each(GENERATED_BY_THE_FRAMEWORK)('git ignores %s', (dir) => {
    expect(isIgnored(`${dir}/anything`)).toBe(true)
  })

  it.each(GENERATED_BY_THE_FRAMEWORK)('eslint ignores %s', (dir) => {
    // Matched against the config text rather than by running ESLint: booting it here would pull
    // the app's whole plugin graph to assert one array. The array is a literal in a template file,
    // so reading it is exact.
    expect(
      eslintConfig.includes(`'${dir}/'`) || eslintConfig.includes(`'${dir}'`),
      `eslint.config.mjs does not ignore ${dir} — a built app lints its own generated output`,
    ).toBe(true)
  })

  it.each(GENERATED_BY_THE_FRAMEWORK)('prettier ignores %s', (dir) => {
    expect(
      prettierIgnore.some((p) => p.replace(/\/$/u, '') === dir),
      `_prettierignore does not cover ${dir}`,
    ).toBe(true)
  })

  it('prettier also ignores the lockfile, which no tool should reformat', () => {
    // `format:check` failing on a file the package manager rewrites on every install leaves a
    // developer choosing between a red gate and a pointless commit.
    expect(prettierIgnore).toContain('pnpm-lock.yaml')
  })

  it('the CLI renames _prettierignore, or the file ships inert', () => {
    // npm strips a leading dot from published files, so the template ships `_prettierignore`. If
    // the scaffold does not rename it, the app gets a file Prettier never reads and the gate is
    // exactly as broken as before, with a file present that suggests otherwise.
    const cli = readFileSync(
      resolve(import.meta.dirname, '../../packages/create-theokit/src/index.ts'),
      'utf-8',
    )

    expect(cli).toContain('_prettierignore')
    expect(cli).toContain('.prettierignore')
  })
})

/**
 * The template's own files pass the gates the template ships.
 *
 * This repository's `.prettierignore` contains `*.md`, so `prettier --check` on a markdown file
 * here answers "All matched files use Prettier code style!" having matched NOTHING. The template's
 * markdown was therefore never formatted by anything — and it ships into an app whose
 * `format:check` does check markdown, so a freshly scaffolded app failed on eleven files it did
 * not write, at minute zero (usetheokit/theokit#444, and #93 before it for ESLint).
 *
 * A gate reporting success on files it never examined is the failure this repository keeps finding
 * elsewhere; it was in its own formatting setup.
 *
 * The check runs prettier against the template with an ignore file that excludes only
 * `node_modules`, which is what a scaffolded app effectively has. Comparing against this repo's
 * ignore list would reproduce the blindness.
 */
describe('the template passes the gates it ships', () => {
  it('every markdown file is formatted to the config the template carries', () => {
    const emptyIgnore = resolve(import.meta.dirname, '../fixtures/prettier-node-modules-only')
    // The repo's own prettier binary by path, not `npx prettier`: `npx` resolves from PATH and
    // may fetch a different version, which would make this assert against a formatter the repo
    // does not use. Both 3.8 and 3.9 were measured to agree on these files, so the version is not
    // what this test is about — determinism is.
    const prettierBin = resolve(import.meta.dirname, '../../node_modules/.bin/prettier')
    const result = spawnSync(
      prettierBin,
      [
        '--check',
        `${TEMPLATE_ROOT}/**/*.md`,
        '--ignore-path',
        emptyIgnore,
        '--config',
        resolve(TEMPLATE_ROOT, '.prettierrc'),
      ],
      { encoding: 'utf8', cwd: resolve(import.meta.dirname, '../..') },
    )

    expect(
      result.stdout + result.stderr,
      'a scaffolded app would fail its own format:check on files it did not write',
    ).not.toMatch(/Code style issues/)
    expect(result.status).toBe(0)
  })
})
