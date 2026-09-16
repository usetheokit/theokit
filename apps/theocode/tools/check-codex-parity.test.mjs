/**
 * Tests for the Codex parity guard.
 *
 * B-158 — `packages/tui/src/commands/codex-names.ts` asserts which Codex commands this product does
 * not implement, and nothing verified that assertion. Measured 2026-09-09 against
 * `@openai/codex@0.153.4`: `recap` was new and `approve` was a rename of `auto-review`, and both
 * answered `unknown command`.
 *
 * The tests that matter here are the ones about a parse that finds nothing. A comparison whose
 * input failed to parse emits an empty list, and an empty list reads as "no drift" on one side and
 * as "everything is missing" on the other. Both are wrong, and neither looks wrong.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/** The repository these tests read their real sources from. */
const REPO_ROOT = new URL('..', import.meta.url).pathname

import {
  DEBUG_ONLY,
  parseCodexCommands,
  parseLocalSurface,
  unaccounted,
  floorViolations,
} from './check-codex-parity.mjs'

const REPO = new URL('..', import.meta.url).pathname

describe('parsing the Codex enum', () => {
  it('test_it_parses_a_kebab_cased_variant', () => {
    const src = 'pub enum SlashCommand {\n    AutoReview,\n    Model,\n}'

    expect(parseCodexCommands(src)).toEqual(['auto-review', 'model'])
  })

  it('test_it_honours_a_strum_serialize_override', () => {
    // Codex annotates two variants this way. A parser that only kebab-cases the variant name
    // reports both as unaccounted and is wrong twice.
    const src = [
      'pub enum SlashCommand {',
      '    #[strum(serialize = "sandbox-add-read-dir")]',
      '    SandboxReadDir,',
      '}',
    ].join('\n')

    expect(parseCodexCommands(src)).toEqual(['sandbox-add-read-dir'])
  })

  it('test_it_reads_only_the_enum_body', () => {
    // `description()` below the enum is a match arm full of `SlashCommand::Name =>` pairs. Reading
    // past the closing brace would double every command and hide a real absence behind a duplicate.
    const src = [
      'pub enum SlashCommand {',
      '    Model,',
      '}',
      'impl SlashCommand {',
      '    pub fn description(self) -> &str {',
      '        match self { SlashCommand::Ghost => "not a variant" }',
      '    }',
      '}',
    ].join('\n')

    expect(parseCodexCommands(src)).toEqual(['model'])
  })
})

describe('parsing the local surface', () => {
  it('test_it_reads_both_the_builtin_list_and_the_pointer_map', () => {
    const registry = "  { name: 'diff', description: 'show the diff' },\n"
    const names = "  [\n    'auto-review',\n    { answer: 'it is /review here', listed: true },\n  ],\n"
    const local = parseLocalSurface(registry, names)

    expect([...local.builtin]).toEqual(['diff'])
    expect([...local.pointers]).toEqual(['auto-review'])
  })
})

describe('computing the delta', () => {
  const local = (builtin, pointers) => ({ builtin: new Set(builtin), pointers: new Set(pointers) })

  it('test_it_reports_a_codex_command_absent_from_both_local_surfaces', () => {
    expect(unaccounted(['recap'], local([], []))).toEqual({ missingHere: ['recap'], staleHere: [] })
  })

  it('test_it_reports_a_pointer_naming_a_command_codex_no_longer_has', () => {
    // The reverse direction, and the one that would have caught `auto-review` becoming `approve`.
    expect(unaccounted(['approve'], local([], ['auto-review']))).toEqual({
      missingHere: ['approve'],
      staleHere: ['auto-review'],
    })
  })

  it('test_a_command_in_the_builtin_list_is_accounted_for', () => {
    // Negative case: something accounted for must NOT be reported.
    expect(unaccounted(['diff'], local(['diff'], [])).missingHere).toEqual([])
  })

  it('test_plan_is_not_accounted_for_by_the_presence_of_plugins', () => {
    // EC-3. Membership, never substring: `includes()` would account for plan, ps, raw and cd —
    // every short name in the surface.
    expect(unaccounted(['plan'], local(['plugins'], [])).missingHere).toEqual(['plan'])
  })

  it('test_codex_debug_commands_are_not_reported_as_gaps', () => {
    // ADR-2: excluded by name, so a fourth debug command shows up and a human decides.
    expect(unaccounted([...DEBUG_ONLY], local([], [])).missingHere).toEqual([])
  })
})

describe('the anti-vacuity floors', () => {
  const local = (b, p) => ({ builtin: new Set(b), pointers: new Set(p) })
  const many = (n, prefix) => Array.from({ length: n }, (_, i) => `${prefix}${i}`)

  it('test_a_codex_parse_that_found_almost_nothing_is_a_violation', () => {
    const v = floorViolations(['model', 'diff'], local(many(46, 'b'), many(24, 'p')))

    expect(v).toHaveLength(1)
    expect(v[0]).toMatch(/2\b.*40/)
  })

  it('test_a_local_parse_that_found_almost_nothing_is_a_violation', () => {
    // EC-1. Without this, a reformatted registry.ts makes every Codex command read as unaccounted:
    // 50+ false positives, a red gate nobody can act on, and a checker deleted from the chain.
    const v = floorViolations(many(53, 'c'), local([], []))

    expect(v).toHaveLength(2)
    expect(v.join(' ')).toMatch(/builtin/)
    expect(v.join(' ')).toMatch(/pointer/)
  })

  it('test_the_real_sources_clear_both_floors', async () => {
    // Positive control on BOTH sides: this fails if either parser breaks.
    const { readFileSync, existsSync } = await import('node:fs')
    const enumPath = join(REPO, 'codex/codex-rs/tui/src/slash_command.rs')
    if (!existsSync(enumPath)) return // the clone is optional; ADR-1

    const codex = parseCodexCommands(readFileSync(enumPath, 'utf8'))
    const parsed = parseLocalSurface(
      readFileSync(join(REPO, 'packages/tui/src/commands/registry.ts'), 'utf8'),
      readFileSync(join(REPO, 'packages/tui/src/commands/codex-names.ts'), 'utf8'),
    )

    expect(floorViolations(codex, parsed)).toEqual([])
    expect(codex.length).toBeGreaterThanOrEqual(40)
    expect(parsed.builtin.size).toBeGreaterThanOrEqual(30)
    expect(parsed.pointers.size).toBeGreaterThanOrEqual(15)
  })
})

describe('the wiring', () => {
  it('test_the_lint_script_invokes_the_parity_checker', async () => {
    // Pillar (a). A checker nothing calls is the exact defect B-158 is about — sixteen checkers ran
    // in this chain and the parity map had none.
    const { readFileSync } = await import('node:fs')
    const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'))

    expect(pkg.scripts.lint).toContain('check-codex-parity')
  })
})

describe('the CLI entry', () => {
  const run = async (root, args = []) => {
    const { execFileSync } = await import('node:child_process')
    try {
      return {
        out: execFileSync(process.execPath, [join(REPO, 'tools/check-codex-parity.mjs'), ...args], {
          encoding: 'utf8',
          env: { ...process.env, CODEX_PARITY_ROOT: root },
        }),
        code: 0,
      }
    } catch (err) {
      return { out: `${err.stdout ?? ''}${err.stderr ?? ''}`, code: err.status ?? 1 }
    }
  }

  const scaffold = () => {
    const root = mkdtempSync(join(tmpdir(), 'parity-'))
    mkdirSync(join(root, 'packages/tui/src/commands'), { recursive: true })
    writeFileSync(
      join(root, 'packages/tui/src/commands/registry.ts'),
      Array.from({ length: 46 }, (_, i) => `  { name: 'b${i}', description: 'x' },`).join('\n'),
    )
    writeFileSync(
      join(root, 'packages/tui/src/commands/codex-names.ts'),
      Array.from({ length: 24 }, (_, i) => `  [\n    'p${i}',\n    { answer: 'x' },\n  ],`).join('\n'),
    )
    return root
  }

  it('test_it_skips_loudly_when_the_codex_checkout_is_absent', async () => {
    const root = scaffold()
    try {
      const { out, code } = await run(root)

      expect(out).toContain('SKIPPED')
      expect(out).toContain('slash_command.rs')
      expect(out).not.toContain('up to date')
      expect(code).toBe(0)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('test_it_skips_when_the_enum_file_is_missing_though_the_clone_exists', async () => {
    // EC-2: the skip keys on the FILE. A restructured clone satisfies a directory check and then
    // throws on the read — a stack trace inside `pnpm lint` instead of the deliberate skip.
    const root = scaffold()
    mkdirSync(join(root, 'codex/codex-rs/tui/src'), { recursive: true })
    try {
      const { out, code } = await run(root)

      expect(out).toContain('SKIPPED')
      expect(out).not.toMatch(/at Object\.|Error:/)
      expect(code).toBe(0)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('test_it_reports_drift_and_exits_non_zero', async () => {
    const root = scaffold()
    mkdirSync(join(root, 'codex/codex-rs/tui/src'), { recursive: true })
    writeFileSync(
      join(root, 'codex/codex-rs/tui/src/slash_command.rs'),
      `pub enum SlashCommand {\n${Array.from({ length: 45 }, (_, i) => `    C${i},`).join('\n')}\n}`,
    )
    try {
      const { out, code } = await run(root)

      expect(code).toBe(1)
      expect(out).toContain('c0')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('test_quiet_prints_nothing_when_there_is_no_drift', async () => {
    // EC-5. `--quiet` suppresses the pleasantry, never the finding.
    const root = scaffold()
    mkdirSync(join(root, 'codex/codex-rs/tui/src'), { recursive: true })
    // A clean state means BOTH directions empty: every Codex command accounted for, and no pointer
    // naming a command Codex does not have. The first draft of this fixture had 24 pointers Codex
    // never declared, so `staleHere` fired and the checker was right to exit 1.
    writeFileSync(
      join(root, 'codex/codex-rs/tui/src/slash_command.rs'),
      `pub enum SlashCommand {\n${[
        ...Array.from({ length: 46 }, (_, i) => `    B${i},`),
        ...Array.from({ length: 24 }, (_, i) => `    P${i},`),
      ].join('\n')}\n}`,
    )
    try {
      const { out, code } = await run(root, ['--quiet'])

      expect(code).toBe(0)
      expect(out.trim()).toBe('')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('the defects the review found, which the suite did not', () => {
  // Every arm below corresponds to a mutant that SURVIVED the original 17 tests. They are grouped
  // because they share one cause: the suite asserted COUNTS, and a parse that finds most of a
  // surface has the right count and the wrong contents. The floors catch a parse that found
  // nothing; only an assertion on the contents catches one that found most.

  it('test_it_reads_a_strum_attribute_that_carries_both_forms', () => {
    // The `AutoReview -> approve` defect, alive inside the fix for it. The anchored pattern needed
    // `)]` right after the first quoted value, so `to_string = "x", serialize = "y"` never matched
    // and the variant fell through to its kebab-cased name. Codex uses this form three times today
    // (`pwd`, `pets`, `stop`) and it passed unnoticed only because each kebab-cases to the same
    // string.
    const src = [
      'pub enum SlashCommand {',
      '    #[strum(to_string = "renamed-thing", serialize = "old-name")]',
      '    SomeVariant,',
      '}',
    ].join('\n')
    expect(parseCodexCommands(src)).toEqual(['renamed-thing'])
  })

  it('test_to_string_wins_over_serialize_when_both_are_present', () => {
    // Positive control for the arm above: a parser that simply took the LAST match would also pass
    // it. `to_string` is what the menu renders and the user types.
    const src = [
      'pub enum SlashCommand {',
      '    #[strum(serialize = "typed-from", to_string = "rendered-as")]',
      '    V,',
      '}',
    ].join('\n')
    expect(parseCodexCommands(src)).toEqual(['rendered-as'])
  })

  it('test_the_real_codex_surface_contains_the_names_this_item_was_raised_for', () => {
    // Counts cannot express this. Against the real enum, dropping `to_string` from the parser
    // returns `auto-review` where the answer is `approve` — same command count, no floor fires.
    // This is the assertion that kills that mutant, and it needs the real source to do it.
    const enumFile = join(REPO_ROOT, 'codex/codex-rs/tui/src/slash_command.rs')
    if (!existsSync(enumFile)) return
    expect(parseCodexCommands(readFileSync(enumFile, 'utf8'))).toEqual(
      expect.arrayContaining(['approve', 'recap', 'subagents', 'setup-default-sandbox']),
    )
  })

  it('test_the_real_pointer_map_is_read_through_both_entry_shapes', () => {
    // Deleting either pointer regex survived, because the unit fixture is matched by both (JS `\s`
    // spans newlines) and the real-source test asserted a COUNT. Measured on the real file: the
    // multi-line regex alone finds 19, the single-line alone 20, the union 24 — and both partial
    // parses clear the floor of 15. Naming one entry from each shape separates them.
    const namesFile = join(REPO_ROOT, 'packages/tui/src/commands/codex-names.ts')
    const registryFile = join(REPO_ROOT, 'packages/tui/src/commands/registry.ts')
    if (!existsSync(namesFile) || !existsSync(registryFile)) return
    const { pointers } = parseLocalSurface(
      readFileSync(registryFile, 'utf8'),
      readFileSync(namesFile, 'utf8'),
    )
    expect([...pointers]).toEqual(expect.arrayContaining(['app', 'keymap', 'approve', 'recap']))
  })
})

describe('the CLI contract, where the review found it unasserted', () => {
  const CLI = new URL('./check-codex-parity.mjs', import.meta.url).pathname

  function run(root) {
    try {
      return { code: 0, stdout: execFileSync('node', [CLI], { env: { ...process.env, CODEX_PARITY_ROOT: root }, encoding: 'utf8' }) }
    } catch (error) {
      return { code: error.status, stdout: `${error.stdout ?? ''}` }
    }
  }

  /** A root whose `codex/` is NOT a git checkout, nested inside one that is. */
  function scaffold({ commands, pointers = true }) {
    const root = mkdtempSync(join(tmpdir(), 'parity-cli-'))
    mkdirSync(join(root, 'codex/codex-rs/tui/src'), { recursive: true })
    mkdirSync(join(root, 'packages/tui/src/commands'), { recursive: true })
    const body = ['pub enum SlashCommand {', ...commands.map((c) => `    ${c},`), '}'].join('\n')
    writeFileSync(join(root, 'codex/codex-rs/tui/src/slash_command.rs'), body)
    writeFileSync(join(root, 'packages/tui/src/commands/registry.ts'),
      pointers ? readFileSync(join(REPO_ROOT, 'packages/tui/src/commands/registry.ts'), 'utf8') : '')
    writeFileSync(join(root, 'packages/tui/src/commands/codex-names.ts'),
      pointers ? readFileSync(join(REPO_ROOT, 'packages/tui/src/commands/codex-names.ts'), 'utf8') : '')
    execFileSync('git', ['init', '-q', root])
    execFileSync('git', ['-C', root, 'commit', '-q', '--allow-empty', '-m', 'host'], {
      env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' },
    })
    return root
  }

  it('test_it_does_not_report_the_host_repository_as_the_codex_revision', () => {
    // `git -C codex log` walks UP when codex/ is not itself a repository, and answers with the
    // ENCLOSING repo's commit. Reproduced before the fix: the checker printed
    // `compared against 3056039`, which was the host's own commit — a precise, confident fact about
    // the wrong object, which is the failure this whole checker exists to detect one level up.
    const root = scaffold({ commands: Array.from({ length: 45 }, (_, i) => `Cmd${i}`) })
    const hostSha = execFileSync('git', ['-C', root, 'log', '-1', '--format=%h'], { encoding: 'utf8' }).trim()
    const { stdout } = run(root)
    expect(stdout).not.toContain(hostSha)
    expect(stdout).toContain('not a git checkout')
  })

  it('test_a_floor_violation_exits_nonzero', () => {
    // The floors are unit-tested; their BLOCKING effect was not. Deleting `return 1` after the
    // violations survived the whole suite, so the guard could be neutralised at the wiring level
    // while `pnpm lint`'s && chain stayed green over a known-broken parse.
    const root = scaffold({ commands: ['OnlyOne'], pointers: false })
    const result = run(root)
    expect(result.code).toBe(1)
    expect(result.stdout).toContain('floor is')
  })

  it('test_a_missing_local_source_is_reported_rather_than_thrown', () => {
    // EC-2 hardened the Codex read against a stack trace inside `pnpm lint`; the two local reads
    // right after it were left bare.
    const root = mkdtempSync(join(tmpdir(), 'parity-cli-'))
    mkdirSync(join(root, 'codex/codex-rs/tui/src'), { recursive: true })
    writeFileSync(join(root, 'codex/codex-rs/tui/src/slash_command.rs'), 'pub enum SlashCommand {\n    A,\n}')
    const result = run(root)
    expect(result.code).toBe(1)
    expect(result.stdout).toContain('not found')
    expect(result.stdout).not.toContain('ENOENT')
  })
})
