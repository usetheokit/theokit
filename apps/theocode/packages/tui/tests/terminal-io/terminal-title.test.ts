/**
 * The bytes, asserted as bytes.
 *
 * A title feature is unusually easy to test vacuously. Every obvious assertion — the composed
 * string is right, the selection changed, the function was called — passes just as happily when
 * nothing ever reached the terminal, which is the ONLY thing a window title is. So every case below
 * looks at what a fake sink received, and the expected values are written as literal escape
 * sequences rather than built from the constants under test: a test that computes its expectation
 * the same way the code does agrees with a typo.
 *
 * The non-TTY cases are not politeness. `theocode | tee log` must not put an escape sequence in
 * that file, and off-TTY is where the whole suite runs, so a guard that only worked on a real
 * terminal would look correct here forever.
 */
import { describe, expect, it, vi } from 'vitest'

import { installTerminalTitle, titleText, writeTerminalTitle } from '../../src/terminal-io/terminal-title.js'

/** A stand-in for `process.stdout` that records rather than paints. */
function sink(isTTY: boolean) {
  const write = vi.fn<(data: string) => void>()
  return { out: { isTTY, write }, write, all: () => write.mock.calls.map(([s]) => s).join('') }
}

describe('the window title reaches the terminal', () => {
  it('test_setting_a_title_writes_the_osc_sequence_to_the_stream', () => {
    const s = sink(true)

    writeTerminalTitle('TheoCode — repo', s.out)

    expect(s.all(), 'no OSC 0 sequence reached the stream — the tab was never told').toBe(
      '\u001b]0;TheoCode — repo\u0007',
    )
  })

  it('test_a_non_tty_stream_receives_nothing_at_all', () => {
    // Anti-vacuity for every case above: a writer that emitted nothing anywhere would pass them
    // only if they asserted on an empty sink, which none of them do.
    const s = sink(false)

    writeTerminalTitle('TheoCode — repo', s.out)

    expect(s.write, 'an escape sequence was written to piped output').not.toHaveBeenCalled()
  })

  it('test_an_empty_title_clears_rather_than_leaving_the_previous_one', () => {
    // `/title none` composes to nothing, and "nothing" has to be a write. Skipping it would leave
    // whatever we last set on screen, so the command that turns the feature off would not.
    const s = sink(true)

    writeTerminalTitle('', s.out)

    expect(s.all(), 'an empty selection left the old title on screen').toBe('\u001b]0;\u0007')
  })
})

describe('untrusted text cannot reshape the escape sequence', () => {
  it('test_a_control_byte_in_a_model_name_is_removed_instead_of_ending_the_session', () => {
    // Reachable without malice: `/model` takes whatever is typed. The toolkit's writer THROWS on a
    // control byte, and this call happens inside a React effect — so an unsanitised value would
    // take down the frame over a cosmetic knob.
    const s = sink(true)

    expect(() => {
      writeTerminalTitle('theo\u0007code\u001b[31m', s.out)
    }, 'a control byte in the title propagated as a throw').not.toThrow()
    expect(s.all()).toBe('\u001b]0;theocode[31m\u0007')
  })

  it('test_newlines_and_tabs_collapse_to_single_spaces', () => {
    expect(titleText('  TheoCode \t\n  repo  ')).toBe('TheoCode repo')
  })

  it('test_a_title_longer_than_the_cap_is_truncated', () => {
    // Terminals truncate silently somewhere in the low hundreds; doing it here is what keeps the
    // emitted sequence bounded regardless of what a path or a model name carries.
    const long = 'a'.repeat(400)

    expect(titleText(long).length, 'the title was emitted unbounded').toBe(240)
  })
})

describe('the terminal gets its own title back', () => {
  it('test_install_pushes_the_existing_title_onto_the_terminal_stack', () => {
    const s = sink(true)

    installTerminalTitle(s.out)

    expect(s.all(), 'nothing was saved, so there is nothing to restore at exit').toBe(
      '\u001b[22;0t',
    )
  })

  it('test_the_disposer_pops_the_saved_title_back', () => {
    // The requirement in one case: after this process is gone, the tab says what it said before.
    const s = sink(true)
    const restore = installTerminalTitle(s.out)
    writeTerminalTitle('TheoCode', s.out)

    restore()

    expect(s.all(), "our title outlived the session in the user's terminal").toBe(
      '\u001b[22;0t\u001b]0;TheoCode\u0007\u001b[23;0t',
    )
  })

  it('test_restoring_twice_emits_the_pop_once', () => {
    // The shutdown path and the `exit` hook both call it. A second pop would restore a title from
    // one stack frame further back — something an unrelated program pushed.
    const s = sink(true)
    const restore = installTerminalTitle(s.out)

    restore()
    restore()

    expect(s.write.mock.calls.filter(([d]) => d === '\u001b[23;0t')).toHaveLength(1)
  })

  it('test_a_non_tty_stream_is_neither_pushed_nor_popped', () => {
    const s = sink(false)

    installTerminalTitle(s.out)()

    expect(s.write, 'a piped run emitted terminal-stack escapes').not.toHaveBeenCalled()
  })
})
