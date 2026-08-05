/**
 * M84 — os símbolos de cliente do agente agora VIVEM em `@theokit/agents/client`. O que resta aqui é
 * PASS-THROUGH: manter uma segunda implementação do mesmo transporte no mesmo processo é exatamente
 * o que o M79 acabou de eliminar. O re-export existe para que quem já importava `theokit/client` não
 * quebre.
 */
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
export {
  consumeUIMessageStream,
  responseToChunkStream,
  consumeChunkStream,
} from '@theokit/agents/client'
export { useAgent } from '@theokit/agents/client/react'
export type { UseAgentReturn, UseAgentOptions, UseAgentStatus } from '@theokit/agents/client/react'

// M47 (ADR-M47-2) — the typed, client-safe agent handle (`useAgent(chat)` — no magic string, no dup type).
export { agentHandle, isAgentHandle } from '@theokit/agents/client'
export type { AgentHandle } from '@theokit/agents/client'

// M41 (ADR-0050) — the unified agent-client transport seam (`ai`'s ChatTransport + optional approve),
// the two shipped transports, and the framework-agnostic store `useAgent` binds over.
export type { AgentTransport, ApprovalDecision, RequestContext } from '@theokit/agents/client'
export { HttpTransport } from '@theokit/agents/client'
export type { HttpTransportOptions } from '@theokit/agents/client'
export { InProcessTransport } from '@theokit/agents/client'
export type {
  InProcessTransportOptions,
  InProcessRunner,
  InProcessRunInput,
  InProcessApprovalRequestLike,
  InProcessAwaitApproval,
} from '@theokit/agents/client'
// M42 (ADR-0051) — Tauri desktop push transport over an injected Channel-shaped source.
export { ChannelTransport } from '@theokit/agents/client'
export type {
  ChannelTransportOptions,
  ChannelPushSource,
  ChannelTurnHandlers,
} from '@theokit/agents/client'
export { AgentClient } from '@theokit/agents/client'
export type { AgentClientState } from '@theokit/agents/client'
// M44 (ADR-0053) — the standalone (no-React) client is also re-exported here for convenience; a node
// consumer should import it from the React-free `theokit/client/core` entry instead.
export { createAgentClient } from './create-agent-client.js'
export type { AgentClientHandle, CreateAgentClientOptions } from './create-agent-client.js'

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

// M30 — client host for MCP App ui:// resources (sandboxed iframe + capability-scoped guest API).
export { mountMcpApp, createGuestMessageHandler, MCP_APP_SANDBOX } from './mcp-app-host.js'
export type { GuestMessage, McpAppHostOptions, McpAppHandle } from './mcp-app-host.js'

/**
 * The wire types, re-exported (plan `remover-dependencia-ai`, EC-7).
 *
 * A scaffolded app pins `theokit`, not `@theokit/presenter` — so an app that needs to name a
 * message type must reach it through a package it already declares. Pointing app code at
 * `@theokit/presenter/wire` directly would make the scaffold import something its manifest never
 * mentions, and it would break on the user's first `npm test`.
 */
export type {
  WireChunk as UIMessageChunk,
  WireMessage as UIMessage,
  WireMessagePart as UIMessagePart,
} from '@theokit/presenter/wire'
