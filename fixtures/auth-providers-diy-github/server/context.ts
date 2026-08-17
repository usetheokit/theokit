import type { SessionData } from 'theokit/server'

/** Per-request context. `session` is populated by the session middleware. */
export interface RequestContext {
  session: SessionData | null
}
