/**
 * The one place `output_style` turns into the instructions the agent is actually built with.
 *
 * A separate file rather than four lines inside `chat.ts` because `chat.ts` is where wiring goes to
 * become untestable: it builds a whole agent, and asserting "the style reached the system prompt"
 * through it means constructing one. Here the question is a pure function of a name and two roots.
 */
import { BASE_INSTRUCTIONS } from './context/index.js'
import { applyOutputStyle, loadOutputStyle } from './context/output-styles.js'

/**
 * The base instructions for this turn, given the configured style name.
 *
 * A name that resolves to nothing falls back to the built-in instructions rather than refusing the
 * turn. Refusing would take the whole product away over a typo in an optional setting; `doctor` is
 * where a name that found no file gets reported.
 */
export function baseInstructionsFor(
  name: string | undefined,
  roots: { home?: string; project: string },
): string {
  if (name === undefined) return BASE_INSTRUCTIONS
  return applyOutputStyle(BASE_INSTRUCTIONS, loadOutputStyle(name, roots))
}
