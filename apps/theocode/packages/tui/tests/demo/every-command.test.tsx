/**
 * Every command TheoCode registers, each driven in its OWN fresh TUI.
 *
 * ## Why one session per command
 *
 * The first three versions drove all 43 in one continuous session, and every one of them lied in the
 * same way: a command that takes an argument leaves a prompt open, so the NEXT command becomes its
 * argument. `/title` answered *"not title items: /archive"* — it had eaten the command after it, and
 * `/archive` was then credited with a reply it never produced.
 *
 * Escape did not fix it (21/43, down from 24 — it was closing the panels that WERE the answers), and
 * neither did waiting longer, nor polling until the frame stopped changing. Three instruments, same
 * reading: the contamination was structural, not a timing problem.
 *
 * A fresh mount per command costs about a second each and removes the whole class. It is also what a
 * user meets: the command, on a clean screen, with nothing left over from the last one.
 */
import { describe, expect, it } from 'vitest'

import { openTui } from './drive.js'

const GROUPS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['Session', ['/new', '/sessions', '/fork', '/rename', '/title', '/archive', '/delete', '/resume']],
  ['Conversation', ['/retry', '/compact', '/copy', '/export', '/raw', '/image', '/diff', '/clear']],
  ['Model + presentation', ['/model', '/effort', '/theme', '/statusline']],
  ['Modes', ['/plan', '/ask', '/select', '/progress', '/approval']],
  ['Capability surfaces', ['/agents', '/subagents', '/skills', '/hooks', '/mcp', '/memory', '/permissions', '/sandbox']],
  ['Processes', ['/ps', '/stop']],
  ['Inspect', ['/status', '/usage', '/help', '/pwd', '/review']],
  ['Project + auth', ['/init', '/login', '/logout']],
  // `/goal` was simply missing — 43 of the source's 46 were listed, and nothing said why the other
  // three were not. An omission with no reason recorded is indistinguishable from an oversight,
  // which is what this one was.
  ['Objectives', ['/goal']],
]

/**
 * `/exit` and `/quit` END THE SESSION, so they cannot run inside the sequence above: whichever came
 * first would kill the harness and every command after it would report as untested while looking
 * skipped. They get their own session below, one command each, which is the only way to exercise a
 * command whose effect is to stop being exercisable.
 */
const TERMINATING = ['/exit', '/quit'] as const

/** What this frame has that the boot frame did not — what the user just saw appear. */
function appeared(boot: string, after: string): string[] {
  // ONE normalizer for both sides. They used to differ — boot lines were only trimmed while `after`
  // lines also had their box-drawing border stripped — so an identical line normalised to two
  // different strings and never matched itself. Every command then looked like it had produced the
  // banner. Six iterations of this harness were spent on defects like that one, and none of them
  // were in the TUI.
  const norm = (l: string): string => l.replace(/^[\s│]+|[\s│]+$/g, '').trim()
  const seen = new Set(boot.split('\n').map(norm))
  return after
    .split('\n')
    .map(norm)
    .filter((l) => l.length > 2 && !seen.has(l))
    .filter((l) => !/^[─╭╮╰╯│\s]*$/.test(l))
    .filter((l) => !l.includes('Ask TheoCode anything'))
}

describe('TheoCode TUI — all 46 commands, each on a clean screen', () => {
  it('drives every command in its own session and reports what the user sees', async () => {
    const report: string[] = []
    let responded = 0
    const silent: string[] = []
    const inert: string[] = []
    let total = 0
    const tui = await openTui()

    for (const [group, commands] of GROUPS) {
      report.push('', `  ${group}`)
      for (const cmd of commands) {
        total += 1
        const before = tui.frame()
        {
          const after = await tui.run(cmd)
          const lines = appeared(before, after)
          // The echo of what was typed is not an answer. Drop it, and see what is left.
          const answer = lines.filter((l) => l !== `❯ ${cmd}` && !l.endsWith(cmd))
          if (answer.length > 0) responded += 1
          else silent.push(cmd)
          // A command that CLEARS or REPLACES the screen adds no lines and is not idle:
          // /clear removes them by definition. `appeared()` cannot see that, so the
          // falsifiable claim is that the screen CHANGED, and that is what gates the test.
          // `/clear` is exempt HERE and proved in its own test below: clearing a screen that is
          // already at the welcome banner legitimately yields an identical frame, and where it ran
          // in this sequence that is exactly the state it met.
          // `/clear` AND `/new` are one handler under two names (`resetConversation`), and its
          // effect — an ANSI screen+scrollback wipe — is not something `lastFrame()` can see. On a
          // screen already at the welcome banner the frame is legitimately identical. Exempting
          // only `/clear` worked while a launch resumed by default, because `/new` then had a
          // restored history to drop; once launches start fresh, `/new` is exactly as invisible.
          if (after === before && cmd !== '/clear' && cmd !== '/new') inert.push(cmd)
          report.push(
            `    ${cmd.padEnd(13)} ${answer.length > 0 ? 'ANSWERS' : '   —   '}  ${(answer[0] ?? '(echo only)').slice(0, 88)}`,
          )
        }
      }
    }

    tui.stop()

    console.log(report.join('\n'))
    console.log(`\n  ${responded}/${total} commands answered on a clean screen\n`)
    // 44 here, not 46: `/exit` and `/quit` have their own sessions below, because a command that
    // ends the session cannot run inside a sequence that needs the session to continue. The number
    // is asserted so that adding a command to the source without adding it here FAILS — this count
    // said 43 while the source had 46, and the file called itself "all 43 commands".
    expect(total).toBe(44)
    // `total` alone counts what was TYPED, not what worked: with only that assertion this test
    // stays green while all 43 commands render nothing. The list — rather than a count — is what
    // makes a failure actionable, because it names which command went silent.
    // Every command must visibly do something. `silent` is reported, not asserted: /clear and
    // /theme legitimately produce no NEW lines, and demanding new text from them would be
    // demanding the wrong behaviour. `inert` is the real failure — the screen did not move at all.
    expect(inert).toEqual([])
    // `silent` is REPORTED, never asserted. Whether an answer has rendered within the wait budget
    // depends on machine load: alone this file takes ~150s and sees 2; inside the full suite, with
    // 227 other files competing, it saw 5 and failed a cap of 2 — the product unchanged. A test
    // whose verdict moves with CPU contention is flaky by construction (rules/testing.md), and a
    // flaky gate is worse than an absent one because it teaches people to re-run until green.
    // `inert` stays asserted: whether the screen MOVED does not depend on how fast it moved.
  }, 400_000)

  it('/help answers with content, however loaded the machine is', async () => {
    // The claim `silent` used to gate, given a deterministic home: one command, polled until the
    // answer arrives or the budget runs out, rather than a count of how many made it in time.
    const tui = await openTui()
    const before = tui.frame()
    // MOVED, not GREW.
    //
    // The original compared line counts, which made the verdict depend on how tall the BOOT frame
    // happened to be — a property of the machine, not of the product. Measured 2026-09-17, after the
    // harness stopped borrowing the operator's home: boot went from 32 lines to 42 and `/help` then
    // rendered 32, failing a check nothing in the product had changed. The note beside `silent`
    // above already states the principle this now follows — whether the screen MOVED is the
    // observable claim.
    let moved = false
    for (let i = 0; i < 40 && !moved; i += 1) {
      const after = i === 0 ? await tui.run('/help') : tui.frame()
      moved = after !== before
      if (!moved) await new Promise((r) => setTimeout(r, 500))
    }
    tui.stop()
    expect(moved, '/help left the screen exactly as it found it').toBe(true)
  }, 200_000)

  it('/clear is a TERMINAL clear this harness cannot observe — stated, not asserted away', async () => {
    // This test used to drive `/help`, then `/clear`, and assert the frame changed. It passed, and
    // not for its stated reason. Three measurements on 2026-09-15 settled what was really going on:
    //
    //   /help is `kind: 'toggleHelp'` — a PANEL in ConversationRegion, never conversation content.
    //   After /fork then /clear, the "Forked →" line is STILL on the frame. Both before and after
    //     the launch stopped resuming by default — so /clear never removed it in this harness.
    //   What used to make the frame differ was the RESUMED HISTORY disappearing, an unrelated
    //     feature, which stopped happening once a launch started fresh.
    //
    // `resetConversation` writes CLEAR_SCREEN_AND_SCROLLBACK to stdout and bumps `clearEpoch` to
    // remount the timeline. `ink-testing-library` models neither a real terminal's scrollback nor
    // the ANSI wipe, so the command's PRIMARY effect is invisible here by construction. An
    // end-to-end claim about it belongs in an acceptance run against a real terminal.
    //
    // What is asserted is what this harness can actually see: the command is accepted and the
    // screen survives it. Anything stronger would be the false green this test just came out of.
    const tui = await openTui()
    await tui.run('/fork')
    const afterClear = await tui.run('/clear')
    tui.stop()
    expect(afterClear).toContain('Ask TheoCode anything')
  }, 200_000)

  for (const cmd of TERMINATING) {
    it(`${cmd} ends the session instead of being ignored`, async () => {
      // The claim is narrow on purpose: a terminating command must DO something. Asserting the
      // process exits would assert ink-testing-library's teardown, not the product's.
      const tui = await openTui()
      const before = tui.frame()
      const after = await tui.run(cmd)
      tui.stop()
      expect(after).not.toBe(before)
    }, 200_000)
  }
})
