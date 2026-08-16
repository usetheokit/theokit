/**
 * T3.3 — the two halves of a custom command, composed against the real filesystem.
 *
 * `loadCustomCommands` reads `.theokit/commands/*.md` and returns the body. `expandCommandTemplate`
 * interprets that body. Until this task the package shipped only the first, so every product that
 * loaded a command then wrote its own interpreter for `$1`, `` !`shell` `` and `@file` — the same
 * format convention, re-derived per product.
 *
 * The unit tests pin each rule of the format in isolation. This one asserts the thing that actually
 * motivated the task: a command file on disk goes in, and a usable prompt comes out, without the
 * consumer supplying a single line of interpretation.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  expandCommandTemplate,
  loadCustomCommands,
} from '../../packages/agents/src/config-entry.js'

function projectWithCommand(name: string, body: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'cmd-expand-'))
  mkdirSync(join(dir, '.theokit', 'commands'), { recursive: true })
  writeFileSync(join(dir, '.theokit', 'commands', `${name}.md`), body, 'utf8')
  return dir
}

describe('a custom command is read and interpreted by the same package', () => {
  it('test_a_command_file_on_disk_expands_into_a_usable_prompt', async () => {
    const dir = projectWithCommand(
      'review',
      [
        '---',
        'description: review a file',
        '---',
        'Review $1 using !`git diff --stat` and @STYLE.md',
      ].join('\n'),
    )

    const { commands } = loadCustomCommands({ projectDir: dir, projectTrusted: true })
    const command = commands.find((c) => c.name === 'review')
    expect(command, 'the loader half must still work unchanged').toBeDefined()

    const warnings: string[] = []
    const prompt = await expandCommandTemplate(command?.body ?? '', '"src/a b.ts"', {
      shell: async (cmd) => ({ text: `[ran ${cmd}]`, ok: true }),
      readFile: (name) => (name === 'STYLE.md' ? 'two spaces, no semicolons' : undefined),
      warn: (m) => warnings.push(m),
    })

    expect(prompt).toBe(
      'Review src/a b.ts using [ran git diff --stat] and two spaces, no semicolons',
    )
    expect(warnings, 'nothing was unresolved, so nothing is reported').toEqual([])
  })

  it('test_an_untrusted_project_yields_no_command_to_expand', async () => {
    // The trust gate belongs to the loader and stays there. Worth asserting at this seam because
    // the expander runs shell segments: a command that should never have loaded must never reach
    // the thing that can execute it.
    const dir = projectWithCommand('danger', 'do !`rm -rf /`')
    const { commands } = loadCustomCommands({ projectDir: dir, projectTrusted: false })
    expect(commands.map((c) => c.name)).not.toContain('danger')
  })
})
