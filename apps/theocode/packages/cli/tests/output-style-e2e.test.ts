/**
 * The style body reaches the COMPILED agent, through the real composition path.
 *
 * `output-style-wiring.test.ts` proves `baseInstructionsFor` composes correctly, and
 * `output-styles.test.ts` proves the loader reads the format. Neither proves anything calls them:
 * both would still pass against a product where `chat.ts` never asks for a style. This is pillar (a)
 * of the wiring triad — a production caller, exercised end to end.
 *
 * It goes through `composeRun` and `compileAgentModule` rather than inspecting the builder, because
 * the builder is closures and a shape check on it would assert about the instrument.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { compileAgentModule } from '@theokit/agents'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { composeRun } from '../src/run-composition.js'

/**
 * B-167 — the operator root. `CompositionSeams` already carried it as `userDir`; it simply was not
 * forwarded to the build, so this test read whatever `~/.theokit/` the machine held.
 */
const OPERATOR_HOME = mkdtempSync(join(tmpdir(), 'b167-cli-home-'))

let cwd: string
let store: string

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'theocode-style-e2e-'))
  store = join(cwd, 'trusted-dirs.json')
  writeFileSync(store, JSON.stringify({ trusted: [cwd] }), { mode: 0o600 })
})
afterEach(() => {
  rmSync(cwd, { recursive: true, force: true })
})

function styled(name: string, body: string, keep: boolean): void {
  mkdirSync(join(cwd, '.claude', 'output-styles'), { recursive: true })
  writeFileSync(
    join(cwd, '.claude', 'output-styles', `${name}.md`),
    `---\nkeep-coding-instructions: ${String(keep)}\n---\n\n${body}\n`,
  )
  mkdirSync(join(cwd, '.theokit'), { recursive: true })
  writeFileSync(join(cwd, '.theokit', 'settings.json'), JSON.stringify({ output_style: name }))
}

async function compiledText(): Promise<string> {
  const composed = await composeRun({ overrides: [] }, { cwd, store, userDir: OPERATOR_HOME })
  return JSON.stringify(compileAgentModule(composed.mod, 'style-e2e'))
}

describe('an output style reaches the compiled agent', () => {
  it('test_the_style_body_is_in_the_compiled_module', async () => {
    styled('terse', 'ANSWER-IN-ONE-SENTENCE', false)
    expect(await compiledText()).toContain('ANSWER-IN-ONE-SENTENCE')
  })

  it('test_without_a_style_that_text_is_not_there', async () => {
    // Anti-vacuity floor: without this arm, a module that happened to contain the phrase for any
    // other reason would satisfy the assertion above.
    mkdirSync(join(cwd, '.theokit'), { recursive: true })
    writeFileSync(join(cwd, '.theokit', 'settings.json'), JSON.stringify({ model: 'openai/x' }))
    expect(await compiledText()).not.toContain('ANSWER-IN-ONE-SENTENCE')
  })
})
