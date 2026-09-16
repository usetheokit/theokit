// The final answer may use the formatting the surface was built to render.
//
// `## Final-answer style` opened with "Plain text; the CLI styles it", and the surface disagrees.
// `@theokit/tui`'s own timeline passes `markdown={role === "assistant"}` under the comment "Claude
// Code parity: an assistant turn is Markdown (headings, lists, fenced code → CodeBlock syntax
// highlight)", and ships 66 passing tests for that rendering — in 0.80.0, the version this product
// consumes.
//
// So the product paid for a Markdown renderer with syntax highlighting and told the model not to
// produce anything it could render. Measured 2026-09-15 in a side-by-side run: asked to name the
// weakest assertion in a test file, two other agents returned the cited code visually separated
// from their prose, and this one returned it as running text. The answers were of comparable
// quality; the difference a reader saw was formatting.
//
// "the CLI styles it" is only true of what the CLI can identify. Without a fence, nothing marks
// where code begins, and the renderer has nothing to act on.

import { describe, expect, it } from 'vitest'

import { BASE_INSTRUCTIONS } from '../../src/context/instructions.js'

describe('BASE_INSTRUCTIONS — final-answer formatting', () => {
  it('does not instruct plain text, which forbids the one thing the surface renders', () => {
    expect(BASE_INSTRUCTIONS).not.toMatch(/Plain text; the CLI styles it/i)
  })

  it('names fenced code as the way to present a snippet', () => {
    expect(BASE_INSTRUCTIONS).toMatch(/fenced|```/i)
  })

  it('keeps the file:line rule, which is what makes a reference clickable', () => {
    expect(BASE_INSTRUCTIONS).toMatch(/file:line/)
  })

  it('still asks for restraint, so the licence is to format code and not to decorate', () => {
    // The old line carried two rules in one breath: "plain text" AND "be concise, skip heavy
    // formatting for simple confirmations". Only the first is wrong; dropping both would trade a
    // formatting gap for a wall of headings on a one-line answer.
    expect(BASE_INSTRUCTIONS).toMatch(/concise/i)
    expect(BASE_INSTRUCTIONS).toMatch(/skip heavy formatting|simple confirmations/i)
  })
})
