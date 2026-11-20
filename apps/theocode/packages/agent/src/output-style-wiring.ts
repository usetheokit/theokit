/**
 * The one place `output_style` turns into the instructions the agent is actually built with.
 *
 * A separate file rather than four lines inside `chat.ts` because `chat.ts` is where wiring goes to
 * become untestable: it builds a whole agent, and asserting "the style reached the system prompt"
 * through it means constructing one. Here the question is a pure function of a name and two roots.
 *
 * #1925 — the LOADER and the composition are the framework's (`loadOutputStyle`, `applyOutputStyle`
 * from `@theokit/agents/config`): `.claude/output-styles/*.md` under the project and the home, the
 * project winning, `keep-coding-instructions` defaulting to false. What stays here is the product
 * decision the framework refuses to make for everyone: the framework THROWS for a configured style
 * no file backs, because a silent fallback hides a style that had no effect; this product takes the
 * opposite side, so a typo in an optional setting does not take the whole product away.
 */
import { homedir } from 'node:os'

import {
  applyOutputStyle,
  loadOutputStyle,
  OutputStyleError,
  type OutputStyle,
} from '@theokit/agents/config'

import { BASE_INSTRUCTIONS } from './context/index.js'

interface StyleRoots {
  home?: string
  project: string
}

/**
 * The configured style, or `undefined` when no file backs the name.
 *
 * The operator's `~/.claude/output-styles/` IS read, which `user-skills.ts` deliberately does not do
 * for skills: an output style is text that CONSTRAINS the agent, not an artifact that adds invokable
 * surface (B-156). The home defaults to the real one; a caller that was handed a home passes it.
 */
function resolveStyle(name: string, roots: StyleRoots): OutputStyle | undefined {
  try {
    return loadOutputStyle({ name, cwd: roots.project, homeDir: roots.home ?? homedir() })
  } catch (error) {
    // The framework's typed refusal: no file backs the name, or two files claim it. Either way the
    // turn goes on with the built-in instructions and `doctor` reports the style as unresolved.
    if (error instanceof OutputStyleError) return undefined
    throw error
  }
}

/** Whether `name` resolves to a style file — what `doctor` reports for a configured name. */
export function outputStyleResolves(name: string, roots: StyleRoots): boolean {
  return resolveStyle(name, roots) !== undefined
}

/**
 * The base instructions for this turn, given the configured style name.
 *
 * A name that resolves to nothing falls back to the built-in instructions rather than refusing the
 * turn. Refusing would take the whole product away over a typo in an optional setting; `doctor` is
 * where a name that found no file gets reported.
 */
export function baseInstructionsFor(name: string | undefined, roots: StyleRoots): string {
  if (name === undefined) return BASE_INSTRUCTIONS
  return applyOutputStyle(BASE_INSTRUCTIONS, resolveStyle(name, roots))
}
