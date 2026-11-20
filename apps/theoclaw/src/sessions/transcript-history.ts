import { readSessionMessages, type SessionMessage } from '@theokit/sdk'

/**
 * The turns of a session, read by the SDK's `readSessionMessages`. TheoClaw does not open,
 * parse or rewrite the transcript: the SDK finds the file from the session id and decides
 * which records are turns, so a change to its transcript format does not reach this code.
 */
export async function readFullHistory(options: {
  readonly cwd: string
  readonly sessionId: string
  readonly sessionDir: string
}): Promise<SessionMessage[]> {
  return readSessionMessages(options)
}
