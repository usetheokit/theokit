import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { loadCustomCommands } from '../../packages/theo/src/config/custom-commands.js'
import { frontmatterValue, splitFrontmatter } from '../../packages/theo/src/config/frontmatter.js'

/**
 * M76 — the `.theokit/commands/` loader.
 *
 * ## The gap this closes
 *
 * The framework OWNS the `.theokit/` convention and already loads `skills/`, `agents/` and
 * `hooks.json` from it. `commands/` — the one directory every product-facing agent surface wants —
 * had no loader, so a consumer wrote markdown-with-frontmatter scanning against the framework's own
 * directory.
 *
 * Real files rather than mocks: precedence, trust gating and malformed-file handling are all about
 * what is on disk, and a mocked filesystem would let each assertion pass while the loader read the
 * wrong directory.
 */

let projectDir: string
let homeDir: string
const warnings: string[] = []
const onWarn = (message: string): void => {
  warnings.push(message)
}

const writeCommand = (root: string, name: string, body: string): void => {
  const dir = join(root, '.theokit', 'commands')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${name}.md`), body, 'utf8')
}

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'theokit-cmd-project-'))
  homeDir = mkdtempSync(join(tmpdir(), 'theokit-cmd-home-'))
  warnings.length = 0
})
afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true })
  rmSync(homeDir, { recursive: true, force: true })
})

describe('loadCustomCommands — reading the convention the framework owns', () => {
  it('test_a_command_loads_with_its_description_and_body', () => {
    writeCommand(projectDir, 'review', '---\ndescription: Review a diff\n---\nDo the review.')
    const { commands } = loadCustomCommands({ projectDir, projectTrusted: true, onWarn })
    expect(commands).toHaveLength(1)
    expect(commands[0]).toMatchObject({
      name: 'review',
      description: 'Review a diff',
      source: 'project',
    })
    expect(commands[0].body.trim()).toBe('Do the review.')
  })

  it('test_a_command_without_frontmatter_is_all_body', () => {
    writeCommand(projectDir, 'plain', 'Just the prompt.')
    const [command] = loadCustomCommands({ projectDir, projectTrusted: true, onWarn }).commands
    expect(command.body.trim()).toBe('Just the prompt.')
    expect(command.description).toBeUndefined()
  })

  it('test_a_missing_commands_directory_is_not_an_error', () => {
    // The common case on a fresh project. Throwing would make "no commands yet" a failure.
    expect(loadCustomCommands({ projectDir, homeDir, projectTrusted: true }).commands).toEqual([])
  })

  it('test_non_markdown_files_are_ignored', () => {
    // Anti-vacuity: without this, a loader that read every file would pass the tests above.
    const dir = join(projectDir, '.theokit', 'commands')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'notes.txt'), 'not a command', 'utf8')
    writeCommand(projectDir, 'real', 'body')
    const { commands } = loadCustomCommands({ projectDir, projectTrusted: true, onWarn })
    expect(commands.map((c) => c.name)).toEqual(['real'])
  })
})

describe('trust — a project command is a prompt from the working directory', () => {
  it('test_project_commands_do_NOT_load_when_the_directory_is_untrusted', () => {
    // Same decision as M68: for an agent pointed at a repository the user just cloned, the working
    // directory is attacker-controlled content, and a command is a prompt that runs on their behalf.
    writeCommand(projectDir, 'review', 'body')
    const { commands } = loadCustomCommands({ projectDir, projectTrusted: false, onWarn })
    expect(commands).toEqual([])
    expect(warnings.join('\n')).toMatch(/not trusted/i)
  })

  it('test_the_refusal_says_how_many_were_skipped', () => {
    // Silence would let a user believe their commands do not exist, rather than that they were
    // refused — two very different things to go debug.
    writeCommand(projectDir, 'a', 'body')
    writeCommand(projectDir, 'b', 'body')
    loadCustomCommands({ projectDir, projectTrusted: false, onWarn })
    expect(warnings.join('\n')).toMatch(/2 project command/)
  })

  it('test_USER_commands_load_without_any_trust_gate', () => {
    // Counter-proof, and the asymmetry that makes the gate meaningful: `~/.theokit/` is the
    // operator's own machine. Gating it too would be refusing the user access to their own files.
    writeCommand(homeDir, 'mine', 'body')
    const { commands } = loadCustomCommands({ homeDir, projectTrusted: false, onWarn })
    expect(commands.map((c) => c.name)).toEqual(['mine'])
  })
})

describe('precedence — project over user, explicitly', () => {
  it('test_a_project_command_WINS_over_the_user_one_with_the_same_name', () => {
    // The project is the more specific scope: a repository that ships a `review` command means ITS
    // review, and letting the operator's generic one take precedence would make the repository's own
    // configuration the weaker statement.
    writeCommand(homeDir, 'review', 'user version')
    writeCommand(projectDir, 'review', 'project version')
    const { commands } = loadCustomCommands({ projectDir, homeDir, projectTrusted: true, onWarn })
    expect(commands).toHaveLength(1)
    expect(commands[0].source).toBe('project')
    expect(commands[0].body.trim()).toBe('project version')
  })

  it('test_the_override_is_REPORTED_not_silent', () => {
    // A user whose command stopped working needs to learn it was overridden, not conclude it broke.
    writeCommand(homeDir, 'review', 'user version')
    writeCommand(projectDir, 'review', 'project version')
    loadCustomCommands({ projectDir, homeDir, projectTrusted: true, onWarn })
    expect(warnings.join('\n')).toMatch(/overrides the user-level one/i)
  })

  it('test_commands_from_both_layers_coexist_when_names_differ', () => {
    writeCommand(homeDir, 'mine', 'user')
    writeCommand(projectDir, 'theirs', 'project')
    const { commands } = loadCustomCommands({ projectDir, homeDir, projectTrusted: true, onWarn })
    expect(commands.map((c) => c.name).sort((a, b) => a.localeCompare(b))).toEqual([
      'mine',
      'theirs',
    ])
  })
})

describe('shadowing a builtin — the loader warns and does NOT decide', () => {
  it('test_a_builtin_collision_is_reported', () => {
    writeCommand(projectDir, 'help', 'my own help')
    const { shadowedBuiltins } = loadCustomCommands({
      projectDir,
      projectTrusted: true,
      builtinNames: ['help', 'clear'],
      onWarn,
    })
    expect(shadowedBuiltins).toEqual(['help'])
    expect(warnings.join('\n')).toMatch(/same name as a builtin/i)
  })

  it('test_the_shadowing_command_is_STILL_returned', () => {
    // The milestone is explicit: the loader warns, the product's router resolves. Dropping it here
    // would make that decision invisibly, on behalf of a product this layer cannot see.
    const { commands } = loadCustomCommands({
      projectDir: (writeCommand(projectDir, 'help', 'mine'), projectDir),
      projectTrusted: true,
      builtinNames: ['help'],
      onWarn,
    })
    expect(commands.map((c) => c.name)).toEqual(['help'])
  })
})

describe('a malformed file fails per FILE, never per directory', () => {
  it('test_unclosed_frontmatter_skips_that_command_and_keeps_the_rest', () => {
    writeCommand(projectDir, 'broken', '---\ndescription: never closes\nbody here')
    writeCommand(projectDir, 'fine', 'good')
    const { commands } = loadCustomCommands({ projectDir, projectTrusted: true, onWarn })
    expect(commands.map((c) => c.name)).toEqual(['fine'])
    expect(warnings.join('\n')).toMatch(/never closes/i)
  })
})

describe('splitFrontmatter — the piece both loaders share', () => {
  it('test_a_file_without_frontmatter_is_all_body', () => {
    expect(splitFrontmatter('hello')).toEqual({ frontmatter: [], body: 'hello' })
  })

  it('test_an_unclosed_fence_returns_undefined_rather_than_guessing', () => {
    // Guessing whether the rest is body or metadata feeds the caller either the wrong text or the
    // wrong settings. Both callers turn `undefined` into "skip this file, warn, keep going".
    expect(splitFrontmatter('---\nkey: value\nno close')).toBeUndefined()
  })

  it('test_frontmatterValue_strips_matching_quotes_only', () => {
    // An unbalanced quote is more likely part of the value than a delimiter, and eating it would
    // silently change what the user wrote.
    expect(frontmatterValue(['a: "quoted"'], 'a')).toBe('quoted')
    expect(frontmatterValue(["b: 'single'"], 'b')).toBe('single')
    expect(frontmatterValue([`c: it's fine`], 'c')).toBe(`it's fine`)
  })

  it('test_an_absent_key_is_undefined', () => {
    expect(frontmatterValue(['a: 1'], 'missing')).toBeUndefined()
  })
})
