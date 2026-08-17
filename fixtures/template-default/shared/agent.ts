/**
 * Shared agent metadata — the single source of truth for branding used across every layer (the agent's
 * instructions, the server, and each frontend surface). `shared/` holds code that is imported by more
 * than one layer; keeping this here means the greeting, name, and model label are defined ONCE instead of
 * being copy-pasted into `app/`, `tui/`, and `frontend/`.
 */
export const AGENT = {
  /** Display name shown in the UI header and available to the agent's persona. */
  name: 'TheoKit agent',
  /** Model display label. The provider-prefixed id the agent actually runs lives in `agents/chat.ts`. */
  model: 'gpt-4o-mini',
  /** The agent's opening line, shown before the first user turn so the conversation starts warm. */
  greeting: "Hi — I'm your TheoKit agent. Ask me anything and I'll stream a reply.",
} as const
