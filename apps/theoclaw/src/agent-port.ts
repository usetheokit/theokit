/**
 * What TheoClaw needs of an agent, for both the chat replies and the `/control` turns: one
 * container builds the agents of both, so the port is declared once.
 *
 * The stream element is the narrow `{ type }`, not the presenter's or the bridge's `SdkMessage`:
 * those declare an index signature the SDK's message interfaces do not, so the SDK agent would
 * not be assignable to a port typed with them.
 *
 * There is no `close` here on purpose. The request boundary (`createContainer().withAgent`) disposes
 * the agent through `Symbol.asyncDispose` when the turn ends. In `@theokit/sdk` 5.11 `close()` only
 * marks the agent disposed, so calling it first makes that disposal return without tearing the
 * session down, and every turn would leak its agent session.
 */
export interface TurnAgent {
  send(text: string): Promise<TurnRun>
}

export interface TurnRun {
  stream(): AsyncIterable<{ readonly type: string }>
  /** How the run ended; a failed one may carry the SDK's error code. */
  wait(): Promise<{ readonly status: string; readonly error?: { readonly code?: string } }>
  /** Move the run to cancelled and stop its in-flight tool calls; the SDK `Run` always has it (plan D2). */
  cancel(): Promise<void>
}
