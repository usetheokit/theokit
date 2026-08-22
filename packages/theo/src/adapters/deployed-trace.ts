/**
 * The request id a deployed entry uses, and the header it echoes back.
 *
 * ## The defect this closes
 *
 * Every generated entry minted a fresh `randomUUID()` per request and set no correlation header
 * at all on a success path (usetheokit/theokit#410). Both Node paths do the opposite: they resolve
 * an incoming `traceparent` / `x-request-id` through `extractTraceId` and echo the result under
 * both `x-request-id` and `x-trace-id` (`cli/commands/start/request-handler.ts`,
 * `vite-plugin/api-middleware.ts`).
 *
 * The consequence is that a trace crossing into a deployed function starts over. The caller's id
 * is discarded, and the response carries nothing to correlate against — so a request that fails in
 * production cannot be tied to the client that made it, which is the one situation the id exists
 * for.
 *
 * ## Why `setHeader` before the handler, rather than wrapping the response
 *
 * It is what the Node path does, and the shim reproduces Node's semantics exactly: `writeHead`
 * MERGES into the header map rather than replacing it (`web-shim.ts`), so a header set here
 * survives the handler's own `writeHead` and a handler that sets its own id still wins. Wrapping
 * the finished `Response` instead would have to mutate a response whose body is already streaming
 * (#382), and would miss the branches that return before the shim is built.
 */

/**
 * Lines that resolve the request id and echo it, as generated source.
 *
 * @param requestVar - the name the entry gave the Web `Request` in scope
 * @param indent - leading whitespace, so the emitted file stays readable
 */
export function deployedTraceFragment(requestVar: string, indent: string): string[] {
  return [
    `${indent}// #410 — honour the caller's trace id instead of minting a new one, and echo it.`,
    `${indent}// \`extractTraceIdFromRequest\` validates the caller-controlled \`x-request-id\``,
    `${indent}// before trusting it, and falls back to a fresh UUID when neither header is present.`,
    `${indent}const requestId = extractTraceIdFromRequest(${requestVar})`,
    `${indent}res.setHeader('x-request-id', requestId)`,
    `${indent}res.setHeader(TRACE_HEADER, requestId)`,
  ]
}
