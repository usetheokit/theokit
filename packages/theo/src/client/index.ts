export { theoFetch, TheoFetchError } from './theo-fetch.js'
export type { InferResponse, InferQuery, InferBody, TheoFetchOptions } from './theo-fetch.js'

// G1 — typed-client Proxy facade over theoFetch.
export { createAppClient } from './app-client.js'
export type { CreateAppClientOptions } from './app-client.js'

export { createBatcher } from './batch.js'
export type {
  Batcher,
  BatchRequest,
  BatchResponse,
  BatchTransport,
  BatcherOptions,
} from './batch.js'

export { stableQueryKey, buildUseTheoQueryConfig } from './react-query-adapter.js'

// T5.2 — Agent stream hook + pure SSE primitive
export { useAgentStream } from './use-agent-stream.js'
export type {
  UseAgentStreamReturn,
  UseAgentStreamOptions,
  AgentStreamStatus,
} from './use-agent-stream.js'

export { consumeAgentStream, parseSSEChunk } from './agent-stream-core.js'

// Link with prefetch — instant navigation for multi-page apps
export { Link } from './link.js'
export type { LinkProps, PrefetchBehavior } from './link.js'

// SEO — metadata helper (React 19 native hoisting)
export { Metadata } from './metadata.js'
export type { MetadataProps } from './metadata.js'

// Image — lazy loading + responsive
export { Image } from './image.js'
export type { ImageProps } from './image.js'
export type { ConsumeOptions } from './agent-stream-core.js'

// T1.1 — Re-export AgentEvent for client consumers (useAgentStream, etc.)
// T2.2 (architecture-cleanup) — types now live in core/contracts/ (per ADR-0001 v3).
export type {
  AgentEvent,
  AgentMessageEvent,
  AgentToolCallEvent,
  AgentToolResultEvent,
  AgentErrorEvent,
} from '../core/contracts/agent-events.js'
export type {
  Fetcher,
  FetchOptionsLike,
  QueryKey,
  UseTheoQueryConfig,
} from './react-query-adapter.js'
