import type { SessionData } from 'theokit/server'

export interface RequestContext {
  session: SessionData | null
}
