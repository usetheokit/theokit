import type { HookHandlers } from '@theokit/agents'

/**
 * Lifecycle hooks — the seam where you observe or intercept the agent loop.
 *
 * A tool call is the moment your agent stops talking and starts *doing*: it hits the network, writes
 * a row, sends a message. This hook makes every one of those visible, with the timing, so a slow or
 * looping agent is something you can see in a log rather than something you infer from a user
 * complaint.
 *
 * Eight events exist. These two are the pair you almost always want first:
 *
 * | Event | When | Can it stop the call? |
 * |---|---|---|
 * | `pre_tool_call` | before the tool runs | **yes** — return `{ block: true, message }` |
 * | `post_tool_call` | after it returns | no — fire-and-forget |
 * | `transform_tool_result` | folds the turn's results before the model sees them | rewrites |
 * | `transform_llm_output` | folds the model's text | rewrites |
 * | `on_session_start` / `on_session_end` | session lifecycle | no |
 * | `pre_user_send` / `post_assistant_reply` | around a user turn | no |
 *
 * ## Why this one only observes
 *
 * `pre_tool_call` is the only hook with veto power, and it is tempting to ship a template that uses
 * it. It is deliberately not used here: a veto encodes a policy, and any policy this file could
 * invent would be one your app did not ask for. `send_notification` is already gated the right way
 * — by a human approval in `chat.ts` — which is where a decision belongs when a person should make
 * it. Reach for the veto when you have a rule of your own:
 *
 * ```ts
 * pre_tool_call: (ctx) =>
 *   ctx.name === 'delete_account' && !isAdmin(ctx)
 *     ? { block: true, message: 'Only an admin may delete an account.' }
 *     : undefined,
 * ```
 *
 * The message goes to the MODEL, not the user — write it as an instruction the agent can act on.
 */

/** Start times by `${runId}:${name}`, so a duration survives concurrent calls in one run. */
const started = new Map<string, number>()

function key(runId: string, name: string): string {
  return `${runId}:${name}`
}

export const toolAuditHooks: HookHandlers = {
  pre_tool_call: (ctx) => {
    started.set(key(ctx.runId, ctx.name), Date.now())
    // One structured line per call. Structured, not a sentence, because the thing you will want
    // later is a filter (`tool=weather`), and a sentence has to be parsed back apart to give you one.
    console.info(
      JSON.stringify({ event: 'tool.start', tool: ctx.name, runId: ctx.runId, args: ctx.args }),
    )
    // `undefined` lets the call through. Returning nothing is not the same as approving nothing:
    // this hook makes no decision, and that is the point of the docblock above.
    return undefined
  },

  post_tool_call: (ctx) => {
    const k = key(ctx.runId, ctx.name)
    const startedAt = started.get(k)
    started.delete(k)
    console.info(
      JSON.stringify({
        event: 'tool.end',
        tool: ctx.name,
        runId: ctx.runId,
        // Absent rather than zero when the start was never seen — a duration of 0ms would read as
        // an instant call instead of as a missing measurement.
        ms: startedAt === undefined ? undefined : Date.now() - startedAt,
      }),
    )
  },
}
