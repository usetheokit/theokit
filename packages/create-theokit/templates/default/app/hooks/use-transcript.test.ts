// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import type { UIMessage } from 'ai'

// Mock the agent client. Since M46 the store owns the conversation `thread`; the hook is a thin
// projection, so we drive the mock's `thread`/`status` and assert the hook maps + delegates correctly.
const send = vi.fn()
const resetAgent = vi.fn()
let agentThread: UIMessage[] = []
let agentStatus = 'idle'
vi.mock('theokit/client', () => ({
  useAgent: () => ({
    thread: agentThread,
    send,
    status: agentStatus,
    reset: resetAgent,
    error: undefined,
  }),
}))

const { useChatTranscript } = await import('./use-transcript')

function textOf(part: unknown): string {
  return (part as { text?: string }).text ?? ''
}

describe('useChatTranscript', () => {
  it('starts warm — the thread is just the greeting, and onlyGreeting is true', () => {
    agentThread = []
    agentStatus = 'idle'
    const { result } = renderHook(() => useChatTranscript())
    expect(result.current.thread).toHaveLength(1)
    expect(result.current.thread[0].id).toBe('greeting')
    expect(result.current.onlyGreeting).toBe(true)
  })

  it('sendMessage delegates to the store (which owns appending the user turn)', () => {
    agentThread = []
    agentStatus = 'idle'
    const { result } = renderHook(() => useChatTranscript())
    act(() => result.current.sendMessage('hello'))
    expect(send).toHaveBeenCalledWith({ message: 'hello' })
  })

  it('projects the store thread after the greeting; onlyGreeting is false once a turn exists', () => {
    agentThread = [
      { id: 'u-0', role: 'user', parts: [{ type: 'text', text: 'hi' }] },
      { id: 'a-0', role: 'assistant', parts: [{ type: 'text', text: 'hello there' }] },
    ]
    agentStatus = 'done'
    const { result } = renderHook(() => useChatTranscript())
    expect(result.current.thread).toHaveLength(3) // greeting + user + assistant
    expect(result.current.thread[0].id).toBe('greeting')
    const last = result.current.thread[2]
    expect(last.role).toBe('assistant')
    expect(textOf(last.parts[0])).toBe('hello there')
    expect(result.current.onlyGreeting).toBe(false)
  })

  it('reset delegates to the store reset', () => {
    agentThread = []
    agentStatus = 'idle'
    const { result } = renderHook(() => useChatTranscript())
    act(() => result.current.reset())
    expect(resetAgent).toHaveBeenCalled()
  })
})
