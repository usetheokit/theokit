/**
 * theokit#93 — the `default` template must pass its OWN `npm run lint` at minute zero.
 *
 * A freshly scaffolded app failed with `@typescript-eslint/no-empty-object-type` on
 * `types/jobs.d.ts`, whose `interface JobRegistry {}` is empty ON PURPOSE — it is the module
 * augmentation the user fills in as they create jobs. The first lesson TheoKit taught was that its
 * gate lies.
 *
 * The test RUNS ESLINT for real, with the template's own config. A structural assertion ("the config
 * contains such-and-such override") would start lying the day `tseslint.configs.recommended` turned
 * on another rule — which is exactly how this defect was born.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

const TEMPLATE_ROOT = resolve(__dirname, '../../packages/create-theokit/templates/default')

/** Only the declaration files — where the augmentations live and where the defect was. */
function declarationFiles(): string[] {
  const found: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = resolve(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'dist') continue
        walk(full)
      } else if (entry.name.endsWith('.d.ts')) {
        found.push(full)
      }
    }
  }
  walk(TEMPLATE_ROOT)
  return found
}

async function lint(files: string[]): Promise<ESLint.LintResult[]> {
  const eslint = new ESLint({
    cwd: TEMPLATE_ROOT,
    overrideConfigFile: resolve(TEMPLATE_ROOT, 'eslint.config.mjs'),
  })
  return eslint.lintFiles(files)
}

describe('the default template passes its own lint (#93)', () => {
  it('no `.d.ts` in the template produces a lint error', async () => {
    const files = declarationFiles()
    // If the template stops having declaration files, this test becomes a silent vacuum.
    expect(files.length).toBeGreaterThan(0)

    const results = await lint(files)

    const errors = results.flatMap((r) =>
      r.messages
        .filter((m) => m.severity === 2)
        .map(
          (m) =>
            `${r.filePath.replace(TEMPLATE_ROOT, '')}:${String(m.line)} ${m.ruleId ?? '?'} — ${m.message}`,
        ),
    )
    expect(errors).toEqual([])
  }, 60_000)

  it('the `JobRegistry` augmentation stays empty — that is its point', () => {
    // If somebody "fixes" the lint by filling in the interface, the scaffolded app starts declaring a
    // job that does not exist, and `ctx.queue.enqueue` lies about what is enqueueable. This file's
    // green must come from the CONFIG, not from mutilating the augmentation.
    const jobs = readFileSync(resolve(TEMPLATE_ROOT, 'types/jobs.d.ts'), 'utf-8')
    expect(jobs).toMatch(/interface JobRegistry \{[\s/*][^}]*\}/)
    expect(jobs).not.toMatch(/interface JobRegistry \{\s*'[^']+':/)
  })
})
