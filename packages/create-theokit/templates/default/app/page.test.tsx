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
  it('renders the empty state + quick actions + composer on first load', () => {
    render(<Page />)
    expect(screen.getByText('What should we build today?')).toBeDefined()
    expect(screen.getByText('Summarize this page')).toBeDefined()
    expect(screen.getByText('Show available tools')).toBeDefined()
    expect(screen.getByText('Start a new conversation')).toBeDefined()
    expect(screen.getByPlaceholderText('Ask the agent…')).toBeDefined()
    expect(screen.getByLabelText('Open command palette')).toBeDefined()
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
