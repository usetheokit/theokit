/**
 * M71 — `@theokit/agents/session`: the session LIFECYCLE vocabulary.
 *
 * The store was fully supplied (29 pass-throughs under `/persistence`); what had no home was the
 * vocabulary above it. See `session-lifecycle.ts` for the ADR line that keeps this from becoming
 * ownership of the store: nothing here writes a transcript.
 */
export {
  deleteSession,
  forkBeforeUserTurn,
  listSessions,
  protectedTranscripts,
  SessionInUseError,
  type DeleteSessionOptions,
  type DeleteSessionResult,
  type SessionSummary,
} from './session-lifecycle.js'

export { loadOrCreateSessionId, persistSessionId, sessionPointerPath } from './session-pointer.js'

export {
  projectDirFor,
  projectDirMatches,
  recordProjectDir,
  resolveProjectDir,
} from './project-index.js'
