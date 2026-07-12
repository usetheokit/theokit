// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { ChatThread, ChatMessage, type UIMessage } from '@theokit/ui'
import Page from './page'

/**
 * Guards the chat page against `@theokit/ui` API drift (issue #80): a fresh scaffold
 * must both type-check AND render. Renders the real React tree in jsdom.
 */
describe('default chat page', () => {
  it('opens with the agent greeting + honest starter prompts + composer + a working New chat', () => {
    const { container } = render(<Page />)
    // The agent greets first — the transcript starts warm. ChatMessage renders the text across markdown
    // spans, so assert the assistant message container structurally, not by text.
    expect(container.querySelector('[data-theo-chat-message="assistant"]')).not.toBeNull()
    // Honest starter prompts (each sends a real message the agent can answer) + the composer.
    expect(screen.getByText('What can you help me with?')).toBeDefined()
    expect(screen.getByText('Write a haiku about TypeScript')).toBeDefined()
    expect(screen.getByPlaceholderText('Message the agent…')).toBeDefined()
    // `New chat` (reset) is real — no fake cost/token meters or dead History/Settings buttons here.
    expect(screen.getByLabelText('New chat')).toBeDefined()
  })

  it('ChatMessage accepts a UIMessage and renders its message container (auto-dispatch)', () => {
    const assistant: UIMessage = {
      id: 'a-0',
      role: 'assistant',
      parts: [{ type: 'text', text: 'Reading src/index.ts', state: 'done' }],
    }
    const { container } = render(
      <ChatThread>
        <ChatMessage message={assistant} />
      </ChatThread>,
    )
    expect(container.querySelector('[data-slot="chat-message"]')).not.toBeNull()
    expect(container.querySelector('[data-theo-chat-message="assistant"]')).not.toBeNull()
  })
})
