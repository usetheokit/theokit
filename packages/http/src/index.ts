// @theokit/http — public barrel
export * from './decorators/index.js'
export * from './metadata/index.js'
export * from './bridge/index.js'
export * from './exceptions/index.js'
export { TheoApp, type TheoAppOptions, type ReadinessCheck } from './app.js'
export {
  createTypedClient,
  TypedClientError,
  type TypedClient,
  type RouteMap,
  type RouteDefinition,
} from './typed-client.js'
export { contract } from './contract.js'
export { createStaticHandler, getMimeType, isSafePath, type StaticOptions } from './static.js'
export {
  getRequestContext,
  tryGetRequestContext,
  type TheoRequestContext,
} from './request-context.js'
// B-M74-01 — three modules that shipped with tests and no door: `action-encryption`,
// `server-inserted-html` and `css-resource`. Each had a unit test, so the code ran; each was
// reachable ONLY by relative path from that test, never through this barrel and never as a build
// entry. No consumer could import them.
//
// They are now SUBPATHS (`@theokit/http/action-encryption`, `/server-inserted-html`,
// `/css-resource`) rather than members of this barrel. Putting them here first pushed the main
// bundle from 28.9K to 31.1K against a 30K budget — and that budget is a real decision, not an
// obstacle: three capabilities most apps never touch should not be paid for by every app that
// imports the package. The subpath makes them reachable AND opt-in, which is what the pattern
// already does for `runtime/node` and `theokit-plugin`.
//
// Same shape as the M73 defect one milestone earlier, which is why it is named rather than quietly
// fixed: a green test suite proves the code WORKS, never that it is REACHABLE.

export { digestError, type ErrorContext, type DigestedError } from './error-digest.js'
export { composeComponentTree, type RouteTree } from './component-tree.js'
export {
  renderToStream,
  streamToResponse,
  type StreamRenderOptions,
  type StreamRenderResult,
} from './stream-renderer.js'
export {
  revalidateTag,
  revalidatePath,
  getRevalidationSignals,
  type RevalidationSignal,
} from './cache-signal.js'
