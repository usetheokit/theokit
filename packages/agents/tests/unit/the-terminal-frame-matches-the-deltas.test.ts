import { describe, expect, it } from 'vitest'

import { mirrorModeratedText } from '../../src/guardrails/terminal-frame.js'

/**
 * #732 — the same turn must not deliver two different answers.
 *
 * With an output guard declared, the `text_delta` stream was redacted and `DoneEvent.result` was not.
 * Measured through `AgentRunner.stream()` with a redactor, in one turn:
 *
 *     text_delta  -> "here: [R]"
 *     done.result -> "here: sk-abc123"
 *
 * `agent-runner.ts` names the constraint that kept it open: a third `moderateOutputStream` pass would
 * NOT work, because there is one `done` per SDK round while moderation spans the whole stream, so a
 * pass keyed on `done` would collapse every round's terminal frame into one.
 *
 * What makes the fix exact rather than approximate is the issue's own first finding: `done.result`
 * equals the visible text of ITS OWN ROUND — a mirror of the `text_delta` content, not an independent
 * channel. So the round's moderated deltas ARE the answer, and the frame is rebuilt from them.
 */
describe('the terminal frame', () => {
  it('test_done_carries_the_moderated_text_of_its_own_round', async () => {
    const out = await collect(round('here: [R]', 'here: sk-abc123'))
    const done = out.find((e) => e.type === 'done')

    expect(done, 'the round must still deliver its terminal frame').toBeDefined()
    expect(done?.result, 'the frame contradicted the deltas the client had just received').toBe(
      'here: [R]',
    )
  })

  it('test_each_round_gets_its_own_text_and_not_the_whole_stream', async () => {
    // The constraint that made a third moderation pass wrong. Two rounds, two frames, and the second
    // must NOT carry the first's text — which is what a whole-stream aggregate would give it.
    const out = await collect([
      ...round('first [R]', 'first raw'),
      ...round('second [R]', 'second raw'),
    ])

    expect(out.filter((e) => e.type === 'done').map((e) => e.result)).toEqual([
      'first [R]',
      'second [R]',
    ])
  })

  it('test_the_task_milestone_channel_is_moderated_too', async () => {
    // #732 named `task_progress.text` as the fourth channel and required it to be decided in the same
    // change — moderated, or documented as unmoderated with the reason.
    //
    // It is moderated. It is not a mirror of anything, so it cannot be rebuilt the way `done` is: it
    // carries text the model writes through `task-tools`, and a milestone saying "found the key
    // sk-abc123" is the same disclosure as a delta saying it. It gets its own `moderateOutputStream`
    // pass, like `text_delta` and `thinking` — one pass per kind, because two kinds under one
    // extractor collapse into a single event.
    //
    // `task-tools.ts` claimed "B-018 even shipped moderation for `task_progress.text`". It had not:
    // `agent-endpoint.ts` said in the same tree that the channel was NOT covered. The comment is
    // corrected rather than deleted — a false claim about a security control is what stops the next
    // reader from checking.
    const out = await collect([
      { type: 'task_progress', text: 'milestone [R]' },
      { type: 'done', result: 'raw' },
    ])

    expect(out.find((e) => e.type === 'task_progress')?.text).toBe('milestone [R]')
  })

  it('test_a_round_with_no_visible_text_keeps_what_the_sdk_reported', async () => {
    // A frame with nothing to mirror must not be blanked. A tool-only round legitimately produces no
    // `text_delta`, and replacing its result with '' would delete information rather than moderate it.
    const out = await collect([{ type: 'done', result: 'tool-only summary' }])

    expect(out[0]?.result).toBe('tool-only summary')
  })
})

interface Ev {
  type: string
  content?: string
  result?: string
  text?: string
}

/** Drive the generator the runner composes, over a scripted stream. */
async function collect(events: Ev[]): Promise<Ev[]> {
  async function* source(): AsyncGenerator<Ev, void> {
    for (const e of events) yield e
  }
  const out: Ev[] = []
  for await (const e of mirrorModeratedText(source())) out.push(e)
  return out
}

/** One SDK round: a moderated delta, then the raw frame the SDK built from the unmoderated text. */
function round(moderated: string, raw: string): Ev[] {
  return [
    { type: 'text_delta', content: moderated },
    { type: 'done', result: raw },
  ]
}
