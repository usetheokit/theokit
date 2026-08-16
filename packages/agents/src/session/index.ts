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
  SessionRegistryRemoverError,
  type DeleteSessionOptions,
  type DeleteSessionResult,
  type SessionSummary,
} from './session-lifecycle.js'

export { loadOrCreateSessionId, persistSessionId, sessionPointerPath } from './session-pointer.js'

export {
  projectDirFor,
  projectsRoot,
  projectDirMatches,
  recordProjectDir,
  resolveProjectDir,
} from './project-index.js'

// M72 — retention policy over the lifecycle vocabulary above. The SDK is explicit that retention is
// the application's to decide; this is the framework deciding it once so each app does not.
export {
  GCFloorError,
  GCProtectionUnavailableError,
  planTranscriptGC,
  runTranscriptGC,
  type GCCandidate,
  type GCError,
  type GCKept,
  type RunTranscriptGCResult,
  type TranscriptGCOptions,
  type TranscriptGCPlan,
} from './gc/transcript-gc.js'

/**
 * T2.6 — why an empty session list can be empty. Framework-owned because it reads THEOKIT_HOME and
 * this package's  layout: a product should not explain a directory it does not control.
 */
export { transcriptRootHint } from './transcript-root-hint.js'
