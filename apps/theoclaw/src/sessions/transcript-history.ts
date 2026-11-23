import { readThreadHistoryFile, threadToUIMessages } from '@theokit/agents/session'
import type { WireMessage } from '@theokit/presenter/wire'

/**
 * Every turn of a transcript, in file order. The framework reader takes the real path and skips
 * lines that are not JSON objects; the converter keeps each assistant record as its own message, so
 * the count `sessions list` shows is the count of records.
 */
export function readFullHistory(options: { readonly transcript: string }): WireMessage[] {
  const history = readThreadHistoryFile(options.transcript, { skipMalformed: true })
  if (history.state === 'unreadable') throw new Error(history.reason)
  return threadToUIMessages(history.messages, { mergeAssistant: false })
}
