/**
 * B-080 — the warning fires on the way UP, once per level.
 *
 * Repeating every turn is how a warning becomes noise, and this one guards a failure that lands
 * mid-answer.
 */
import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'

import { useContextWarning } from '../../src/rendering/use-context-warning.js'

function drive(steps: readonly (number | undefined)[], window = 100): string[] {
  const seen: string[] = []
  const warn = (m: string): void => {
    seen.push(m)
  }
  function Probe({ used }: { used: number | undefined }): null {
    useContextWarning(used, window, warn)
    return null
  }
  const instance = render(<Probe used={steps[0]} />)
  for (const used of steps.slice(1)) instance.rerender(<Probe used={used} />)
  instance.unmount()
  return seen
}

describe('B-080 — useContextWarning', () => {
  it('test_it_says_nothing_while_there_is_room', () => {
    expect(drive([0, 10, 40])).toEqual([])
  })

  it('test_it_warns_once_when_the_level_rises', () => {
    // 80 crosses the warn threshold; 82 and 84 are the same level and must stay quiet.
    expect(drive([10, 80, 82, 84])).toHaveLength(1)
  })

  it('test_it_warns_again_when_it_becomes_critical', () => {
    // A second, different message: the stakes changed.
    const seen = drive([10, 80, 95])
    expect(seen).toHaveLength(2)
    expect(seen[1]).toContain('nearly full')
  })

  it('test_falling_back_says_nothing', () => {
    // After a /compact the level drops. Good news needs no toast, and announcing it would train
    // the user to dismiss the channel the bad news arrives on.
    expect(drive([10, 95, 20])).toHaveLength(1)
  })

  it('test_it_re_arms_after_a_compaction', () => {
    // Filling up again must warn again — a latch that never resets warns once per process.
    expect(drive([10, 95, 20, 95])).toHaveLength(2)
  })

  it('test_an_absent_reading_mid_stream_does_not_re_arm', () => {
    // B-012 — written BEFORE the rewrite, to fail the WRONG version of it.
    //
    // An absent reading is NO INFORMATION. The tempting adoption maps `undefined` to `'ok'`, and
    // `'ok'` is a FALL, which re-arms the detector — so 82 would warn a second time for a level
    // the user was already told about. The test below it drives `[undefined, undefined]`, absent
    // at the START, and would stay green through exactly that regression.
    expect(drive([10, 80, undefined, 82])).toHaveLength(1)
  })

  it('test_an_absent_usage_reading_is_not_a_signal', () => {
    // Before the first turn there is no usage. Treating undefined as zero would be harmless here
    // and treating it as full would be an alarm on every startup.
    expect(drive([undefined, undefined])).toEqual([])
  })
})
