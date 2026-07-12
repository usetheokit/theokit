'use client'

import { useEffect, useState } from 'react'
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
import { CommandPalette, Avatar, Tooltip, Button, ScrollArea, type CommandItem } from '@usetheo/ui'
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
 *   QuickActionChips          → first-load suggestions
 *   ContextWindowBar          → context usage at top
 *   CommandPalette            → ⌘K quick actions
 *   Avatar / Tooltip          → message faces + icon hints
 *
 * `useAgent` binds to the `agents/chat.ts` endpoint and consumes the ai-sdk `UIMessageStream`. It opens a
 * FRESH stream per send, so `messages` hold only the CURRENT turn (and carry no stable id) — we OWN the
 * transcript: `history` accumulates every finished turn with our own unique ids (`u-N` / `a-N` / `greeting`),
 * and the in-flight reply is shown live until it commits. This keeps the order correct, the history complete,
 * and every id unique. Edit `agents/chat.ts` to pick your model / add tools.
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

/** The agent's opening line — so the conversation starts warm instead of empty. */
const GREETING: UIMessage = {
  id: 'greeting',
  role: 'assistant',
  parts: [
    {
      type: 'text',
      text: "Hi — I'm your TheoKit agent. Ask me anything and I'll stream a reply. Try a quick action below or type your own.",
    },
  ],
}

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
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [history, setHistory] = useState<UIMessage[]>([GREETING])
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

  const isStreaming = status === 'streaming'
  const users = history.filter((m) => m.role === 'user').length
  const replies = history.filter((m) => m.role === 'assistant' && m.id !== 'greeting').length
  // A sent prompt is still awaiting its committed reply — the current turn is "in flight".
  const pending = users > replies

  // Merge the in-flight turn's parts into ONE assistant message with our own unique id (the SDK's ids are
  // empty, which would collide in the thread). `suffix` distinguishes the live copy from the committed one.
  const inflightReply = (suffix: string): UIMessage => ({
    id: `a-${String(replies)}${suffix}`,
    role: 'assistant',
    parts: messages.flatMap((m) => m.parts),
  })

  // Commit the finished reply into history exactly once (the next send resets `messages`).
  useEffect(() => {
    if (!isStreaming && pending && messages.length > 0) {
      setHistory((h) => [...h, inflightReply('')])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStreaming, pending, messages, replies])

  // Transcript = committed history + the in-flight reply (shown until it commits — no flicker, no double).
  const thread = pending && messages.length > 0 ? [...history, inflightReply('-live')] : history
  const onlyGreeting = history.length === 1 && !isStreaming

  function handleSubmit(value: string) {
    const trimmed = value.trim()
    if (!trimmed) return
    setHistory((h) => [
      ...h,
      { id: `u-${String(h.length)}`, role: 'user', parts: [{ type: 'text', text: trimmed }] },
    ])
    send({ message: trimmed })
    setComposerValue('')
  }

  function handleQuickAction(id: string) {
    setPaletteOpen(false)
    if (id === 'reset') {
      setHistory([GREETING])
      reset()
      return
    }
    const action = QUICK_ACTIONS.find((a) => a.id === id)
    // Quick-action labels are strings; only a string can be sent as a prompt.
    if (action && typeof action.label === 'string') handleSubmit(action.label)
  }

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
          {onlyGreeting && (
            <QuickActionChips actions={QUICK_ACTIONS} onSelect={handleQuickAction} />
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
