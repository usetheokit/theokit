/**
 * What TheoClaw needs of an agent, for both the chat replies and the `/control` turns: one
 * container builds the agents of both, so the port is declared once.
 *
 * The stream element is the narrow `{ type }`, not the presenter's or the bridge's `SdkMessage`:
 * those declare an index signature the SDK's message interfaces do not, so the SDK agent would
 * not be assignable to a port typed with them.
 */
export interface TurnAgent {
  send(text: string): Promise<TurnRun>
  close?(): void
}

export interface TurnRun {
  stream(): AsyncIterable<{ readonly type: string }>
  /** How the run ended; a failed one may carry the SDK's error code. */
  wait(): Promise<{ readonly status: string; readonly error?: { readonly code?: string } }>
}
