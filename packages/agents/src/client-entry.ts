/**
 * M84 — `@theokit/agents/client`: a cadeia de cliente do agente, vinda do pacote CLI.
 *
 * ## Por que ela mudou de pacote
 *
 * Estes nove módulos moravam em `theokit/client` (o pacote **CLI**), e nada dentro do CLI dependia
 * deles — eram folha ali. O que os prendia era história, não desenho. A consequência era concreta: um
 * consumidor da camada que quisesse um transporte in-process tinha de declarar dependência de runtime
 * no CLI, isto é, num pacote que a fronteira `SDK → Theokit → AgentBuilder` o proíbe de tratar como
 * camada. O agent-builder carregava seis isenções escritas só para sustentar essa contradição.
 *
 * ## Por que DOIS subpaths, e não a barra principal
 *
 * `use-agent.ts` — **um** dos nove — importa React. Colocar a cadeia na barra principal faria cada
 * consumidor da camada carregar React no grafo, inclusive quem nunca renderiza nada.
 *
 * E um subpath só não bastava: um consumidor Node (um transporte num processo sem UI) importaria o
 * barril e arrastaria React junto. Esta entrada é **livre de React** por contrato — travado por
 * `test_client_core_entry_imports_no_react`, um gate que já existia no CLI e que pegou a regressão na
 * primeira execução. O hook mora em `@theokit/agents/client/react`.
 *
 * O CLI passa a re-exportar DAQUI (pass-through puro): duas implementações do mesmo transporte no
 * mesmo processo é exatamente o que o M79 acabou de eliminar.
 */

// O seam de transporte: `ai`'s ChatTransport + aprovação opcional, e o store que `useAgent` observa.
export type { AgentTransport, ApprovalDecision, RequestContext } from './client/transport.js'

export { HttpTransport } from './client/http-transport.js'
export type { HttpTransportOptions, HeadersResolver } from './client/http-transport.js'

export { InProcessTransport } from './client/in-process-transport.js'
export type {
  InProcessTransportOptions,
  InProcessRunner,
  InProcessRunInput,
  InProcessApprovalRequestLike,
  InProcessAwaitApproval,
} from './client/in-process-transport.js'

export { ChannelTransport } from './client/channel-transport.js'
export type {
  ChannelTransportOptions,
  ChannelPushSource,
  ChannelTurnHandlers,
} from './client/channel-transport.js'

export { AgentClient } from './client/agent-client.js'
export type { AgentClientState } from './client/agent-client.js'

export { agentHandle, isAgentHandle } from './client/agent-handle.js'
export type { AgentHandle } from './client/agent-handle.js'

export {
  consumeUIMessageStream,
  responseToChunkStream,
  consumeChunkStream,
} from './client/consume-ui-message-stream.js'

export { extractLastUserText } from './client/last-user-text.js'

// `useAgent` NÃO mora aqui — ver `client-react-entry.ts`. Esta entrada é livre de React por contrato.
export type { UseAgentStatus } from './client/agent-client.js'
