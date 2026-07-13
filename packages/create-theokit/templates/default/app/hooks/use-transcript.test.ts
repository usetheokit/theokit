// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

// Mock the agent client so the hook's transcript logic is tested deterministically (no real stream).
const send = vi.fn()
const resetAgent = vi.fn()
vi.mock('theokit/client', () => ({
  useAgent: () => ({ messages: [], send, status: 'idle', reset: resetAgent, error: undefined }),
}))

const { useChatTranscript } = await import('./use-transcript')

function textOf(part: unknown): string {
  return (part as { text?: string }).text ?? ''
}

describe('useChatTranscript', () => {
  it('starts warm — the thread is just the greeting, and onlyGreeting is true', () => {
    const { result } = renderHook(() => useChatTranscript())
    expect(result.current.thread).toHaveLength(1)
    expect(result.current.thread[0].id).toBe('greeting')
    expect(result.current.onlyGreeting).toBe(true)
  })

  it('sendMessage appends the user message and starts an agent turn', () => {
    const { result } = renderHook(() => useChatTranscript())
    act(() => result.current.sendMessage('hello'))
    const last = result.current.thread[result.current.thread.length - 1]
    expect(last.role).toBe('user')
    expect(textOf(last.parts[0])).toBe('hello')
    expect(send).toHaveBeenCalledWith({ message: 'hello' })
    // A user message means the greeting is no longer alone.
    expect(result.current.onlyGreeting).toBe(false)
  })

  it('reset clears the transcript back to the greeting and cancels the stream', () => {
    const { result } = renderHook(() => useChatTranscript())
    act(() => result.current.sendMessage('hi'))
    act(() => result.current.reset())
    expect(result.current.thread).toHaveLength(1)
    expect(result.current.thread[0].id).toBe('greeting')
    expect(resetAgent).toHaveBeenCalled()
  })
})
