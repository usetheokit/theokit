import { ChatThread, ChatMessage, AgentStreaming, QuickActionChips } from '@theokit/ui'
import { type UIMessage } from '@theokit/ui'
import { ScrollArea } from '@usetheo/ui'

import { MODEL_NAME, STARTERS } from '../lib/constants'

/**
 * The scrolling transcript: the message thread + a live streaming indicator + the starter prompts (shown
 * only while the conversation is empty). Presentational — it receives the transcript and reports a chosen
 * starter; all state lives in `hooks/use-transcript.ts`.
 */
export function ChatPanel({
  thread,
  isStreaming,
  onlyGreeting,
  onStarter,
}: {
  thread: UIMessage[]
  isStreaming: boolean
  onlyGreeting: boolean
  onStarter: (label: string) => void
}) {
  return (
    <ScrollArea className="flex-1">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-6 py-6">
        <ChatThread>
          {thread.map((message) => (
            <ChatMessage key={message.id} message={message} />
          ))}
          {isStreaming && <AgentStreaming model={MODEL_NAME} />}
        </ChatThread>
        {onlyGreeting && (
          <QuickActionChips
            actions={STARTERS}
            onSelect={(id) => {
              const action = STARTERS.find((s) => s.id === id)
              if (action && typeof action.label === 'string') onStarter(action.label)
            }}
          />
        )}
      </div>
    </ScrollArea>
  )
}
