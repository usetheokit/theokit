'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  ChatThread,
  ChatMessage,
  ChatComposer,
  AgentStreaming,
  AgentErrorCard,
  QuickActionChips,
  ContextWindowBar,
  type UIMessage,
  type QuickAction,
} from '@theokit/ui'
import {
  EmptyState,
  CommandPalette,
  Avatar,
  Tooltip,
  Button,
  ScrollArea,
  type CommandItem,
} from '@usetheo/ui'
import { Sparkles, Wrench, RotateCcw, Command } from 'lucide-react'
import { useAgent } from 'theokit/client'

/**
 * Default scaffold — an Agent Surface, composed entirely from TheoUI.
 *
 *   ChatThread / ChatMessage  → conversation (ChatMessage auto-dispatches text,
 *                               tool-call, and reasoning parts of each UIMessage)
 *   AgentStreaming            → streaming indicator
 *   AgentErrorCard            → error display
 *   ChatComposer              → bottom input bar
 *   EmptyState                → first-load screen
 *   ContextWindowBar          → context usage at top
 *   CommandPalette            → ⌘K quick actions
 *   Avatar                    → assistant/user face in messages
 *   Tooltip                   → hints on icons
 *
 * `useAgent` binds to the `agents/chat.ts` endpoint, consumes the ai-sdk
 * `UIMessageStream`, and handles AbortController cleanup + StrictMode safety.
 * `messages` are the reconstructed ASSISTANT `UIMessage[]`; user turns are tracked
 * locally and interleaved. Edit `agents/chat.ts` to pick your model / add tools.
 */

const QUICK_ACTIONS: QuickAction[] = [
  { id: 'summarize', label: 'Summarize this page', icon: Sparkles },
  { id: 'tools', label: 'Show available tools', icon: Wrench },
  { id: 'reset', label: 'Start a new conversation', icon: RotateCcw },
]

const COMMAND_ITEMS: CommandItem[] = QUICK_ACTIONS.map((a) => ({
  id: a.id,
  label: a.label,
  icon: a.icon,
  group: 'Quick actions',
}))

// Display-only context-window hint. The agent's real model lives in `agents/chat.ts`
// (`model: 'openai/gpt-4o-mini'`); wire real token counts from the stream when you need them.
const CONTEXT_USED = 4_200
const CONTEXT_TOTAL = 200_000
const MODEL_NAME = 'gpt-4o-mini'

const ASSISTANT_AVATAR = (
  <Avatar size="sm" tone="primary">
    <Avatar.Fallback>TH</Avatar.Fallback>
  </Avatar>
)
const USER_AVATAR = (
  <Avatar size="sm" tone="muted">
    <Avatar.Fallback>YOU</Avatar.Fallback>
  </Avatar>
)

export default function Page() {
  const [composerValue, setComposerValue] = useState('')
  const [userMessages, setUserMessages] = useState<UIMessage[]>([])
  const [paletteOpen, setPaletteOpen] = useState(false)
  const { messages, send, status, reset } = useAgent<{ message: string }>('/api/agents/chat')

  // ⌘K / Ctrl+K opens the CommandPalette.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setPaletteOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Interleave local user turns with the reconstructed assistant UIMessages,
  // turn by turn. `ChatMessage` renders each message's parts (text/tool/reasoning).
  const thread = useMemo<UIMessage[]>(() => {
    const out: UIMessage[] = []
    const turns = Math.max(userMessages.length, messages.length)
    for (let i = 0; i < turns; i++) {
      const user = userMessages[i]
      const assistant = messages[i]
      if (user) out.push(user)
      if (assistant) out.push(assistant)
    }
    return out
  }, [userMessages, messages])

  function handleSubmit(value: string) {
    const trimmed = value.trim()
    if (!trimmed) return
    const userMessage: UIMessage = {
      id: `u-${String(userMessages.length)}`,
      role: 'user',
      parts: [{ type: 'text', text: trimmed }],
    }
    setUserMessages((prev) => [...prev, userMessage])
    send({ message: trimmed })
    setComposerValue('')
  }

  function handleQuickAction(id: string) {
    setPaletteOpen(false)
    if (id === 'reset') {
      setUserMessages([])
      reset()
      return
    }
    const action = QUICK_ACTIONS.find((a) => a.id === id)
    // Quick-action labels are strings; only a string can be sent as a prompt.
    if (action && typeof action.label === 'string') handleSubmit(action.label)
  }

  const isStreaming = status === 'streaming'
  const isEmpty = thread.length === 0 && !isStreaming
  const hasError = status === 'error'

  return (
    <>
      <ContextWindowBar
        used={CONTEXT_USED}
        total={CONTEXT_TOTAL}
        trailing={MODEL_NAME}
        label="Context window"
        compact
        className="border-border/60 border-b px-6 py-2"
      />

      <ScrollArea className="flex-1">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-6 py-6">
          {isEmpty ? (
            <EmptyState
              eyebrow="Theo Agent"
              icon={Sparkles}
              title="What should we build today?"
              description="Ask anything. This scaffold ships an agent at agents/chat.ts — edit it to pick your model or add tools."
              action={<QuickActionChips actions={QUICK_ACTIONS} onSelect={handleQuickAction} />}
            />
          ) : (
            <ChatThread>
              {thread.map((message) => (
                <ChatMessage
                  key={message.id}
                  message={message}
                  avatar={message.role === 'assistant' ? ASSISTANT_AVATAR : USER_AVATAR}
                />
              ))}
              {isStreaming && <AgentStreaming model={MODEL_NAME} />}
            </ChatThread>
          )}
        </div>
      </ScrollArea>

      <div className="border-border/60 border-t bg-background/50 backdrop-blur">
        <div className="mx-auto w-full max-w-3xl px-6 py-4">
          {hasError && (
            <div className="mb-3">
              <AgentErrorCard
                kind="network"
                title="Stream ended with an error"
                detail="The connection to the agent endpoint was interrupted. Reset to try again."
                actions={
                  <Button variant="ghost" size="sm" onClick={() => reset()}>
                    Reset
                  </Button>
                }
              />
            </div>
          )}
          <ChatComposer
            value={composerValue}
            onValueChange={setComposerValue}
            onSubmit={handleSubmit}
            running={isStreaming}
            placeholder="Ask the agent…"
            leadingActions={
              <Tooltip label="Open command palette (⌘K)" side="top">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setPaletteOpen(true)}
                  aria-label="Open command palette"
                >
                  <Command className="size-4" />
                </Button>
              </Tooltip>
            }
          />
        </div>
      </div>

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        items={COMMAND_ITEMS}
        onSelect={handleQuickAction}
        placeholder="Run a command…"
        emptyMessage="No matching commands."
      />
    </>
  )
}
