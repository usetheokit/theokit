/**
 * `/raw` — the text that leaves the frame must leave it UNCHANGED.
 *
 * The whole value of this command is that what lands in the scrollback is byte-for-byte the reply's
 * source: no box border, no role glyph, and — the one that matters most — no newline inserted where
 * the frame happened to wrap. So the central case compares the written string to the source rather
 * than checking that something was written, and it uses a line longer than any terminal so a
 * re-wrapping implementation cannot pass by accident.
 *
 * The second thing asserted is which SEAM it wrote to. `writeToScrollback` is Ink's
 * `useStdout().write`, which erases the frame, writes, and repaints beneath; the raw stream is the
 * one `/clear` uses and anything written to it is erased by the next repaint. The two are the same
 * file descriptor and the difference is invisible in a diff, so the handler takes the writer as an
 * argument and this file is what pins which one it is given.
 */
import { describe, expect, it, vi } from 'vitest'

import type { ToastPayload } from '../../src/screen-types.js'
import { handleRaw } from '../../src/commands/raw-command.js'

/** A timeline in the shape `deriveTimeline` produces — `{ kind, role, text }`, measured in B-075. */
const message = (role: string, text: string) => ({ kind: 'message', role, text })

function run(arg: string, events: readonly unknown[]) {
  const write = vi.fn<(text: string) => void>()
  const setToast = vi.fn<(t: ToastPayload) => void>()
  handleRaw(arg, events, write, setToast)
  return {
    write,
    written: write.mock.calls.map(([s]) => s).join(''),
    toast: setToast.mock.calls[0]?.[0],
  }
}

/** Long enough that any terminal would have wrapped it, and one paragraph in the source. */
const LONG_LINE = `const x = ${'a'.repeat(400)}`

describe('the reply reaches the scrollback exactly as the model wrote it', () => {
  it('test_the_last_reply_is_written_verbatim_including_a_line_no_terminal_could_fit', () => {
    const events = [message('user', 'hi'), message('assistant', `line one\n${LONG_LINE}\nline two`)]

    const { written } = run('', events)

    expect(
      written,
      'the text was re-wrapped or decorated on its way out — which is the entire defect this command exists to avoid',
    ).toContain(`line one\n${LONG_LINE}\nline two`)
  })

  it('test_nothing_but_the_reply_and_blank_lines_is_written', () => {
    // Anti-decoration. A border, a heading or a role glyph here would be pasted along with the
    // text, which is what mouse-selecting the frame already gives.
    const { written } = run('', [message('assistant', 'hello')])

    expect(written.trim(), 'the writer added something the user did not ask to copy').toBe('hello')
  })

  it('test_the_whole_conversation_is_written_when_all_is_asked_for', () => {
    const { written } = run('all', [message('user', 'question'), message('assistant', 'answer')])

    expect(written).toContain('question')
    expect(written).toContain('answer')
  })

  it('test_the_last_reply_alone_is_written_when_all_is_not_asked_for', () => {
    // Anti-vacuity for the case above: a handler that always exported everything would pass it.
    const { written } = run('', [message('user', 'question'), message('assistant', 'answer')])

    expect(written).not.toContain('question')
  })
})

describe('the command reports honestly when it prints nothing', () => {
  it('test_an_empty_conversation_writes_nothing_and_says_so', () => {
    const { write, toast } = run('', [])

    expect(write, 'a blank block was pushed into the scrollback').not.toHaveBeenCalled()
    expect(toast?.variant).toBe('info')
    expect(toast?.message).toContain('nothing to print')
  })

  it('test_a_conversation_with_no_reply_yet_says_the_agent_has_not_answered', () => {
    // Distinguished from the empty case: "you have not asked anything" and "it has not answered"
    // send the user to different next actions.
    const { toast } = run('', [message('user', 'question')])

    expect(toast?.message).toContain('has not replied')
  })

  it('test_an_unrecognised_argument_is_refused_by_naming_the_one_that_exists', () => {
    const { write, toast } = run('everything', [message('assistant', 'answer')])

    expect(
      write,
      'an unrecognised argument was silently treated as the default',
    ).not.toHaveBeenCalled()
    expect(toast?.variant).toBe('error')
    expect(toast?.message).toContain('all')
  })
})

describe('the command does not claim to be a mode', () => {
  it('test_the_success_toast_describes_a_print_and_never_a_toggle', () => {
    // Codex's `/raw` toggles the transcript's render mode. This cannot — `raw-command.ts` records
    // the two measurements that make it unreachable under Ink — and a toast that borrowed the word
    // anyway would leave the user waiting for the NEXT reply to come out plain.
    const { toast } = run('', [message('assistant', 'answer')])

    expect(toast?.variant).toBe('success')
    expect(toast?.message).toContain('printed above')
    for (const overstatement of ['mode', 'toggle', 'enabled', 'on']) {
      expect(
        toast?.message.split(/\W+/),
        `the toast calls /raw a ${overstatement}, which it is not`,
      ).not.toContain(overstatement)
    }
  })
})
