import { describe, expect, it } from 'vitest'

import { defineCommand, routeCommand } from '../../src/commands/command-router.js'

/**
 * M83 — the command routing MECHANISM, and only that.
 *
 * ## Scope, stated before the code
 *
 * The consumer's terminal surface is 8 639 LOC. Most of it is chrome and widgets, and belongs to
 * `@theokit/ui` / `@theokit/tui`. What this absorbs is the piece with no counterpart anywhere: the
 * registry, longest-prefix routing, and the interpreter shape.
 *
 * What it deliberately does NOT absorb (Top-risk 1): help rendering, aliases, completions. Each is a
 * mini CLI framework growing inside the agents package, and each would need its own ADR with demand.
 * The ~50 command NAMES stay in the product; only the routing comes here.
 *
 * ## Why longest-prefix and not exact match
 *
 * A terminal accepts `/model` and `/model-list`. Under first-match, whichever was registered first
 * swallows the other — and the bug reads as "my command stopped working" long after the registration
 * order changed.
 */

const MODEL = defineCommand({ name: 'model', description: 'show or set the model' })
const MODEL_LIST = defineCommand({ name: 'model-list', description: 'list models' })
const CLEAR = defineCommand({ name: 'clear', description: 'clear the transcript', arg: 'none' })
const SEND = defineCommand({ name: 'send', description: 'send a message', arg: 'required' })

describe('routing picks the LONGEST matching name', () => {
  it('test_an_exact_name_routes_to_it', () => {
    const routed = routeCommand('/clear', [CLEAR])
    expect(routed).toMatchObject({ kind: 'command', command: CLEAR, arg: '' })
  })

  it('test_the_longer_name_wins_over_its_own_prefix', () => {
    // The failure this rule exists for. Under first-match, `/model-list` routes to `model` with the
    // argument `-list`, and the report reads "my command stopped working".
    const routed = routeCommand('/model-list', [MODEL, MODEL_LIST])
    expect(routed).toMatchObject({ kind: 'command', command: MODEL_LIST })
  })

  it('test_the_longer_name_wins_REGARDLESS_of_registration_order', () => {
    // Anti-vacuity: with the array in the other order, a first-match router would also pass the test
    // above. Reversing it is what proves the rule is about length, not position.
    const routed = routeCommand('/model-list', [MODEL_LIST, MODEL])
    expect(routed).toMatchObject({ command: MODEL_LIST })
  })

  it('test_the_shorter_name_still_routes_when_it_is_the_whole_input', () => {
    const routed = routeCommand('/model', [MODEL, MODEL_LIST])
    expect(routed).toMatchObject({ command: MODEL })
  })
})

describe('the argument is what follows the name', () => {
  it('test_the_remainder_is_the_argument', () => {
    const routed = routeCommand('/send hello world', [SEND])
    expect(routed).toMatchObject({ kind: 'command', arg: 'hello world' })
  })

  it('test_a_command_declaring_no_argument_REFUSES_one', () => {
    // `/clear everything` is a user who believes the word did something. Silently dropping it makes
    // the terminal look like it obeyed.
    expect(routeCommand('/clear everything', [CLEAR])).toMatchObject({
      kind: 'error',
      reason: 'unexpected-argument',
    })
  })

  it('test_a_command_REQUIRING_an_argument_refuses_an_empty_one', () => {
    expect(routeCommand('/send', [SEND])).toMatchObject({
      kind: 'error',
      reason: 'missing-argument',
    })
  })

  it('test_surrounding_whitespace_is_not_an_argument', () => {
    expect(routeCommand('/clear   ', [CLEAR])).toMatchObject({ kind: 'command', arg: '' })
  })
})

describe('what is NOT a command', () => {
  it('test_plain_text_is_a_message_not_an_unknown_command', () => {
    // The default has to be "send this to the agent". A terminal that answered "unknown command" to
    // ordinary prose would be unusable.
    expect(routeCommand('what is this repo about?', [MODEL])).toEqual({
      kind: 'message',
      text: 'what is this repo about?',
    })
  })

  it('test_an_unknown_slash_input_is_an_UNKNOWN_command_not_a_message', () => {
    // The asymmetry that makes the previous rule safe: a leading slash is an explicit claim to be a
    // command, and sending `/moddel` to the model as prose hides a typo.
    expect(routeCommand('/moddel gpt-5', [MODEL])).toMatchObject({
      kind: 'error',
      reason: 'unknown-command',
    })
  })

  it('test_a_bare_slash_is_unknown_rather_than_a_crash', () => {
    expect(routeCommand('/', [MODEL])).toMatchObject({ kind: 'error' })
  })

  it('test_empty_input_is_an_empty_message', () => {
    expect(routeCommand('', [MODEL])).toEqual({ kind: 'message', text: '' })
  })
})

describe('custom commands from `.theokit/commands/` route the same way (M76)', () => {
  it('test_a_custom_name_is_routable_alongside_the_builtins', () => {
    // The dependency the milestone declares: M76 loads them, this routes them. Two routers would
    // disagree about precedence, and the disagreement shows up as a command that runs the wrong body.
    const custom = defineCommand({
      name: 'review',
      description: 'from .theokit/commands/review.md',
    })
    expect(routeCommand('/review the diff', [MODEL, custom])).toMatchObject({
      command: custom,
      arg: 'the diff',
    })
  })

  it('test_a_custom_name_that_SHADOWS_a_builtin_is_reported_not_resolved', () => {
    // Same posture as the M76 loader: this layer reports the collision and does not choose. Only the
    // product knows what its builtins do.
    const custom = defineCommand({ name: 'clear', description: 'my own clear' })
    const routed = routeCommand('/clear', [CLEAR, custom])
    expect(routed).toMatchObject({ kind: 'error', reason: 'ambiguous-command' })
  })
})
