/**
 * How something reaches you when nobody is watching.
 *
 * This is the seam a `bot` template cannot omit. In a chat app an approval renders inline: the
 * person who triggered the run is looking at it. On a schedule there is no attached client, so a
 * paused run waits for an approval that has nowhere to appear — the difference between an agent and
 * a bot, in one sentence.
 *
 * ## No channel is wired, and that is the decision
 *
 * A scaffold that defaulted to email would put your address in a file you did not write; one that
 * defaulted to Slack would assume a workspace. Both are product decisions a starting point should
 * not make for you. So the seam is here, it is called from the places that need it, and it prints
 * until you point it somewhere.
 *
 * Printing is not a placeholder for "unimplemented" — it is the honest local behaviour, and it is
 * why the scaffold RUNS before you have configured anything.
 *
 * ## Wiring a real channel
 *
 * Replace the body. One example, deliberately commented rather than installed:
 *
 * ```ts
 * import { Resend } from 'resend'
 * const resend = new Resend(process.env.RESEND_API_KEY)
 * await resend.emails.send({
 *   from: 'bots@yourdomain.dev',
 *   to: process.env.BOT_OWNER_EMAIL!,
 *   subject: message.subject,
 *   text: message.body,
 * })
 * ```
 *
 * `@theokit/plugin-email` gives you the same thing with a provider contract, if you would rather not
 * bind to one vendor.
 */
export interface DeliveryMessage {
  readonly subject: string
  readonly body: string
}

export async function deliver(message: DeliveryMessage): Promise<void> {
  // `await` on nothing keeps the signature honest: every real channel is async, and a caller that
  // learned to omit `await` here would break the day you wire one.
  await Promise.resolve()
  console.log(`\n[bot] ${message.subject}\n${message.body}\n`)
}

/**
 * The approval that could not be shown, delivered instead.
 *
 * Called when a scheduled run pauses on an `.approval()` gate. It carries the run id because
 * approving happens against the run, not against the message — whoever receives this has to be able
 * to act on it.
 */
export async function deliverApproval(input: {
  readonly agent: string
  readonly runId: string
  readonly question: string
}): Promise<void> {
  await deliver({
    subject: `Approval needed: ${input.agent}`,
    body:
      `${input.question}\n\n` +
      `Run: ${input.runId}\n` +
      `Approve: POST /api/agents/${input.agent}/approvals/${input.runId}\n\n` +
      'Nobody was attached when this paused, which is why it reached you here.',
  })
}
