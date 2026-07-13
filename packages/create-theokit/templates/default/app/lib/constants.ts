import { type UIMessage, type QuickAction } from '@theokit/ui'
import { Sparkles } from 'lucide-react'

import { AGENT } from '../../shared/agent'

/**
 * Chat UI constants — kept out of the view so the page + components stay declarative (the pattern Vercel's
 * ai-chatbot uses: starter prompts + greeting live in a constants module, not inline in the component).
 */

/** The model id shown in the streaming indicator (from `agents/chat.ts` via `shared/agent.ts`). */
export const MODEL_NAME = AGENT.model

/** The agent's opening line — so the conversation starts warm instead of empty. */
export const GREETING: UIMessage = {
  id: 'greeting',
  role: 'assistant',
  parts: [{ type: 'text', text: AGENT.greeting }],
}

/** Honest starter prompts — each sends a real message the scaffold agent can actually answer. */
export const STARTERS: QuickAction[] = [
  { id: 'help', label: 'What can you help me with?', icon: Sparkles },
  { id: 'haiku', label: 'Write a haiku about TypeScript', icon: Sparkles },
  { id: 'async', label: 'Explain async/await in one paragraph', icon: Sparkles },
]
