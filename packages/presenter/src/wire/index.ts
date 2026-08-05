/**
 * `@theokit/presenter/wire` — TheoKit's own declaration of the `UIMessageStream` wire.
 *
 * Lives here because `@theokit/presenter` is the only LEAF of the package graph among the packages
 * that need it (`presenter` → nothing intra-repo; `agents` → sdk-*; `theokit` → agents, http), so
 * nothing can import it "upwards" and create the cycle `G1` forbids. It is also the semantic owner:
 * the presenter already produces these frames.
 */

export {
  WIRE_CHUNK_TYPES,
  WIRE_DATA_PART_PREFIX,
  wireChunkSchema,
  type WireChunk,
  type WireDataPart,
} from './chunk-schema.js'

export {
  WireFrameTooLargeError,
  WireStreamError,
  parseWireStream,
  type ParseWireStreamOptions,
} from './parse-wire-stream.js'

export { readMessageStream } from './read-message-stream.js'

export type {
  WireHeaders,
  WireMessage,
  WireMessagePart,
  WireMessageRole,
  WireReconnectOptions,
  WireSendOptions,
  WireTransport,
} from './types.js'
