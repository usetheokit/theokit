/**
 * B-087 — opening a session the TUI already lists.
 *
 * `/sessions` rendered a list with no verb that re-enters an entry, so the listing itself
 * advertised something the surface could not do — the B-067 shape, one command over. The CLI could
 * `resume` all along, which is the asymmetry B-074 measured and left as its sixth gap.
 */
export type ResumeOutcome =
  | { readonly kind: 'refused'; readonly reason: string }
  | { readonly kind: 'resume'; readonly id: string }

/**
 * Decide what `/resume <id>` should do. Pure, so the refusals are testable without a live session.
 *
 * `streaming` is the one hard refusal: swapping the session under a running turn would leave the
 * turn writing into a transcript nobody is looking at any more. Everything else is a message.
 */
export function planResume(input: {
  readonly arg: string
  readonly current: string
  readonly streaming: boolean
  readonly known: readonly string[]
}): ResumeOutcome {
  const id = input.arg.trim()
  if (id.length === 0) {
    return {
      kind: 'refused',
      reason: 'resume needs a session id: /resume <id> — /sessions lists them',
    }
  }
  if (input.streaming) {
    return {
      kind: 'refused',
      reason: 'a turn is still running — press esc to interrupt it first, then /resume',
    }
  }
  if (id === input.current) {
    // Not an error, and not silence either: doing nothing without saying so reads as a failure.
    return { kind: 'refused', reason: `already in ${id}` }
  }
  if (!input.known.includes(id)) {
    return {
      kind: 'refused',
      reason: `no session ${id} in this directory — /sessions lists them`,
    }
  }
  return { kind: 'resume', id }
}
