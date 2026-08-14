export {
  createMockAgentStream,
  type MockAgentStreamOptions,
  type MockResponse,
  type MockStreamEvent,
} from './mock-stream.js'

// M85 — the seam over the vocabulary production actually speaks.
//
// `createMockAgentStream` above emits a snake_case vocabulary NO production path of this framework
// consumes: our terminal renderer switches over the kebab-case `WIRE_CHUNK_TYPES`, and the presenter
// speaks a third. Measured adoption of it: one caller (its own unit test), zero in the only real
// product, which recorded the refusal in prose. These speak the wire and the presenter.
export { createMockOutputEvents, createMockWireStream, wireChunk } from './mock-wire-stream.js'
export { inspectCompiled } from './inspect-compiled.js'
export type { CompiledInspection } from './inspect-compiled.js'
