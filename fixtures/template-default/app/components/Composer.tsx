import { ChatComposer, AgentErrorCard } from '@theokit/ui'
import { Button } from '@usetheo/ui'
import { Plus } from 'lucide-react'

/**
 * The bottom bar: the message input + a `New chat` action, with the agent-error card surfaced above it when
 * a stream fails. Presentational — the parent owns the composer value + the submit / new-chat handlers.
 */
export function Composer({
  value,
  onValueChange,
  onSubmit,
  running,
  hasError,
  error,
  onNewChat,
}: {
  value: string
  onValueChange: (value: string) => void
  onSubmit: (value: string) => void
  running: boolean
  hasError: boolean
  error: Error | undefined
  onNewChat: () => void
}) {
  return (
    <div className="border-border/60 border-t bg-background/50 backdrop-blur">
      <div className="mx-auto w-full max-w-3xl px-6 py-4">
        {hasError && (
          <div className="mb-3">
            <AgentErrorCard
              kind="network"
              title="The agent stream ended with an error"
              detail={error?.message ?? 'Something went wrong. Start a new chat to try again.'}
              actions={
                <Button variant="ghost" size="sm" onClick={onNewChat}>
                  New chat
                </Button>
              }
            />
          </div>
        )}
        <ChatComposer
          value={value}
          onValueChange={onValueChange}
          onSubmit={onSubmit}
          running={running}
          placeholder="Message the agent…"
          leadingActions={
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={onNewChat}
              aria-label="New chat"
              title="New chat"
            >
              <Plus className="size-4" />
            </Button>
          }
        />
      </div>
    </div>
  )
}
