/**
 * Drive the real TUI the way a person drives it.
 *
 * `ink-testing-library` mounts the SAME `<App />` that `main.tsx` mounts, and `stdin.write` delivers
 * the same bytes a keyboard delivers. What it removes is the terminal, and with it the two things
 * that made a tmux-driven check untrustworthy: a `sleep` long enough to HOPE the frame arrived, and
 * a `capture-pane` that reads whichever region happened to be visible.
 *
 * Measured on this repository: the tmux route cost about 25s per interaction and still made me read
 * the wrong rows four times; this route drives a whole session in about five seconds and hands back
 * the exact frame as a string.
 *
 * What it does NOT prove: that a real terminal renders those strings correctly. Colours, wrapping
 * and the alternate screen are the terminal's job, and that is a separate — much smaller — question
 * than whether the command did what it says.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { render } from 'ink-testing-library'

import { App } from '../../src/App.js'

/** Strip ANSI so an assertion is about the text, never about the styling around it. */
const plain = (s: string | undefined): string =>
  // eslint-disable-next-line no-control-regex -- stripping ANSI is matching a control character; that IS the job
  (s ?? '').replace(/\u001B\[[0-9;]*[A-Za-z]/g, '')

export interface Driver {
  type(text: string): Promise<void>
  /** Press Escape — the way a user dismisses whatever panel is open. */
  escape(): Promise<void>
  submit(): Promise<void>
  run(command: string, settleMs?: number): Promise<string>
  frame(): string
  stop(): void
}

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * Point `$HOME` at a throwaway directory for the life of one driven session.
 *
 * The harness mounts the real `<App />` IN THIS PROCESS, so `homedir()` is the operator's own home
 * and a command that writes there writes there for real.
 *
 * Measured 2026-09-17: `every-command.test.tsx` runs `/logout`, `handleLogout` calls
 * `logout(homedir())`, and a credential obtained minutes earlier was gone after `npm test` — with
 * the suite reporting 5 passed. A decoy confirmed the aim: a generic file in the same directory
 * survived and `auth.json` did not.
 *
 * Isolated HERE rather than in `/logout`, because the defect is a suite driving every command
 * against the real environment: the next destructive command would land the same way.
 */
function isolateHome(): { restore: () => void } {
  const isolated = mkdtempSync(join(tmpdir(), 'theocode-tui-home-'))
  const operator = process.env.HOME
  process.env.HOME = isolated
  return {
    restore: () => {
      // The environment is process-wide: a worker shared between test files would otherwise inherit
      // a home that has just been deleted.
      if (operator === undefined) delete process.env.HOME
      else process.env.HOME = operator
      rmSync(isolated, { recursive: true, force: true })
    },
  }
}

export async function openTui(): Promise<Driver> {
  const home = isolateHome()

  const ui = render(<App />)

  /**
   * Wait until the frame stops changing.
   *
   * Used at boot as well as after a command, and the boot case is why it exists twice over: a fixed
   * 1100ms boot delay captured the screen BEFORE the banner rendered, so every command was then
   * credited with "showing" a banner it had nothing to do with. A guessed delay was wrong at both
   * ends of the interaction.
   */
  const settle = async (maxMs = 5000): Promise<string> => {
    let previous = ''
    let stable = 0
    const deadline = Date.now() + maxMs
    while (Date.now() < deadline) {
      await wait(90)
      const current = plain(ui.lastFrame())
      // A frame with nothing in it is not a settled frame. Two identical EMPTY reads used to count
      // as stable, so boot "settled" before the banner had rendered — and every command was then
      // credited with showing a banner it had nothing to do with. Require real content first.
      if (current.length < 200) {
        previous = current
        stable = 0
        continue
      }
      if (current === previous) {
        // Two consecutive identical reads: one is not enough, a stream can pause between chunks.
        if (++stable >= 2) break
      } else {
        stable = 0
        previous = current
      }
    }
    return plain(ui.lastFrame())
  }

  await settle()
  // A floor AFTER the frame settles. The frame reaches its final shape before the session behind it
  // is ready, and a command sent in that window is echoed and then dropped — measured: /pwd echoed
  // and answered nothing, and a later keystroke grew the frame by 0 chars.

  const type = async (text: string): Promise<void> => {
    // Character by character, because that is what a keyboard produces — and because a component
    // that only handled a pasted block would pass a single `write` and fail a real user.
    for (const ch of text) {
      ui.stdin.write(ch)
      await wait(4)
    }
    await wait(60)
  }

  const escape = async (): Promise<void> => {
    ui.stdin.write('\u001B')
    await wait(140)
  }

  const submit = async (): Promise<void> => {
    ui.stdin.write('\r')
    await wait(120)
  }

  return {
    type,
    escape,
    submit,
    /**
     * Type a command, submit it, and wait until the FRAME STOPS CHANGING.
     *
     * Not a fixed delay. A fixed delay was wrong in both directions here: at 420ms every response
     * landed one row late — each capture held the echo of the command just typed and the answer to
     * the one before it — and raising it to 1100ms changed nothing, which is what proved the wait
     * was the wrong instrument. The frame settles when it settles; polling for that is the only
     * timing that is not a guess.
     */
    async run(command: string): Promise<string> {
      await type(command)
      await submit()
      // A slash command opens the command PALETTE, and the first Enter accepts the highlighted
      // entry rather than running it — the same two presses a real user makes. Measured on /help:
      // one CR leaves the text in the input and the screen at 21 lines; a second CR runs it and
      // the screen goes to 51. Without this, 22 of 43 commands reported "silent", which was this
      // harness failing to submit, not the TUI failing to answer.
      if (plain(ui.lastFrame()).includes(`\u276f ${command}`)) await submit()
      // A floor before polling. The frame stabilises with the ECHO of the command long before the
      // answer arrives, and `settle()` would happily call that settled — which it did: every command
      // reported "(echo only)". The floor is the minimum an answer needs to reach the screen.
      await wait(900)
      return settle()
    },
    frame: () => plain(ui.lastFrame()),
    stop: () => {
      ui.unmount()
      // Restore before the next file runs: `process.env` is process-wide, and a worker shared
      // between test files would otherwise inherit a home that has been deleted.
      home.restore()
    },
  }
}
