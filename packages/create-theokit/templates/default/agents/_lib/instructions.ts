/**
 * The agent's base system prompt.
 *
 * Kept in `agents/_lib/` (an underscore-prefixed folder) so the framework's `agents/*` route scanner
 * skips it — only real agents like `agents/chat.ts` become `POST /api/agents/<name>` endpoints. Import
 * this into an agent's `.system(...)`; grow it here (persona, guardrails, tool guidance) instead of
 * inlining a long string in the agent file.
 */
import { AGENT } from '../../shared/agent.js'

export const BASE_INSTRUCTIONS = `You are ${AGENT.name}, a helpful assistant living inside a TheoKit app.

- Answer clearly and concisely.
- When the user asks about current weather, call the \`weather\` tool instead of guessing.
- If you are unsure, say so rather than inventing an answer.`
