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

// M2 — agents/*.ts convention: typed UIMessageStream hook + pure reader.
// (The pre-M2 proprietary agent client surface — the old stream hook, its SSE
// parser, and the tool-card correlator — was removed in the M3 clean break; the
// canonical agent client is `useAgent` over the ai-sdk UIMessageStream wire.)
export { consumeUIMessageStream } from './consume-ui-message-stream.js'
export { useAgent } from './use-agent.js'
export type { UseAgentReturn, UseAgentOptions, UseAgentStatus } from './use-agent.js'

// Link with prefetch — instant navigation for multi-page apps
export { Link } from './link.js'
export type { LinkProps, PrefetchBehavior } from './link.js'

// SEO — metadata helper (React 19 native hoisting)
export { Metadata } from './metadata.js'
export type { MetadataProps } from './metadata.js'

// Image — lazy loading + responsive
export { Image } from './image.js'
export type { ImageProps } from './image.js'
export type {
  Fetcher,
  FetchOptionsLike,
  QueryKey,
  UseTheoQueryConfig,
} from './react-query-adapter.js'
