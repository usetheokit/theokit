/**
 * theokit#93 — o template `default` tem de passar no PRÓPRIO `npm run lint` no minuto zero.
 *
 * Um app recém-scaffoldado reprovava com `@typescript-eslint/no-empty-object-type` em
 * `types/jobs.d.ts`, cuja `interface JobRegistry {}` é vazia DE PROPÓSITO — é a augmentação de
 * módulo que o usuário preenche conforme cria jobs. A primeira lição que o TheoKit dava era que o
 * gate dele mente.
 *
 * O teste RODA O ESLINT de verdade, com a config do próprio template. Uma asserção estrutural
 * ("a config contém tal override") passaria a mentir no dia em que o `tseslint.configs.recommended`
 * ligasse outra regra — que é exatamente como este defeito nasceu.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

const TEMPLATE_ROOT = resolve(__dirname, '../../packages/create-theokit/templates/default')

/** Só os arquivos de declaração — onde vivem as augmentações e onde o defeito estava. */
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

describe('template default passa no próprio lint (#93)', () => {
  it('nenhum `.d.ts` do template produz erro de lint', async () => {
    const files = declarationFiles()
    // Se o template deixar de ter arquivos de declaração, este teste vira vácuo silencioso.
    expect(files.length).toBeGreaterThan(0)

    const results = await lint(files)

    const errors = results.flatMap((r) =>
      r.messages
        .filter((m) => m.severity === 2)
        .map((m) => `${r.filePath.replace(TEMPLATE_ROOT, '')}:${String(m.line)} ${m.ruleId ?? '?'} — ${m.message}`),
    )
    expect(errors).toEqual([])
  }, 60_000)

  it('a augmentação `JobRegistry` continua vazia — é o ponto dela', () => {
    // Se alguém "corrigir" o lint preenchendo a interface, o app scaffoldado passa a declarar um job
    // que não existe, e `ctx.queue.enqueue` mente sobre o que é enfileirável. O verde deste arquivo
    // tem de vir da CONFIG, não de mutilar a augmentação.
    const jobs = readFileSync(resolve(TEMPLATE_ROOT, 'types/jobs.d.ts'), 'utf-8')
    expect(jobs).toMatch(/interface JobRegistry \{[\s/*][^}]*\}/)
    expect(jobs).not.toMatch(/interface JobRegistry \{\s*'[^']+':/)
  })
})
