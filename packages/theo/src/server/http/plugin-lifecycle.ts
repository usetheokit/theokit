/**
 * One bracket around a Node-dispatched request, so every agent branch has the same lifecycle
 * (theokit#324, usetheokit/theokit#405).
 *
 * ## Why this is a function and not a paragraph in a review checklist
 *
 * `executeRoute` and `executeAction` have run the plugin lifecycle since the beginning. The agent
 * branches did not, and they were fixed one at a time: theokit#324 taught the plain
 * `POST /api/agents/<name>` to call `applyDecorations` → `runOnRequest` → handler →
 * `runOnResponse`, with `runOnError` on the failure path, and copied that shape into the dev
 * middleware. The aux routes (thread message and stream, MCP, agent card, approvals listing) and the
 * HITL approve route kept answering without it, in BOTH surfaces, so an application embedding
 * TheoKit had no supported place to observe six endpoints — two of which spend tokens and one of
 * which settles a human decision. The observability plugin is the case that made it legible: no
 * `onRequest` means no `http.request` span, and an operator reading HTTP latency or error rate sees
 * no traffic for endpoints that are serving traffic (usetheokit/theokit#405).
 *
 * A copied bracket is what let five branches drift from one. This is the bracket, once.
 *
 * ## The conversion is here, and only here
 *
 * The lifecycle needs a Web `Request` (that is what `PluginContext` carries), and converting an
 * `IncomingMessage` drains its body exactly once — a second conversion yields a Request whose body
 * is an empty closed stream, which is a silent truncation (theokit#400). So callers hand over a
 * {@link WebRequestSource}, whose `toRequest()` memoizes, and hand the SAME source to the handler
 * they wrap. Converting is therefore idempotent across the bracket, by construction rather than by
 * anyone noticing.
 *
 * The caller must still only enter this bracket on a path it is about to answer: `toRequest()` runs
 * here, and running it to decide ownership is the theokit#400 hang.
 */
import type { ServerResponse } from 'node:http'

import type { PluginContext } from '../plugin-types.js'
import type { PluginRunner } from '../plugins/plugin-runner.js'

import type { WebRequestSource } from './node-request.js'
import { sendError } from './send-response.js'

/** What the bracket needs from the branch it wraps. */
export interface PluginLifecycleTarget {
  /** The unconverted request. Converted once, here — see the module docstring. */
  source: WebRequestSource
  res: ServerResponse
  requestId: string
  /** Absent ⇒ no plugins are registered, and the bracket costs one object allocation. */
  pluginRunner: PluginRunner | undefined
  /** The 500 message when the handler (or the conversion) throws, e.g. `'Agent handler failed'`. */
  failureMessage: string
}

function messageOf(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback
}

/**
 * Run `serve` inside the plugin lifecycle: decorations, `onRequest` (which may short-circuit),
 * the handler, `onError` on a throw, and `onResponse` after the response is written.
 *
 * Mirrors `executeRoute`'s shape deliberately — same `PluginContext`, same short-circuit contract,
 * same `onError` placement. An agent route should not have a lifecycle of its own.
 *
 * Never throws: a handler failure becomes a 500 through the same `sendError` envelope the branches
 * used before, so the caller's `logRequest` still reads a settled `res.statusCode`.
 */
export async function serveThroughPluginLifecycle(
  target: PluginLifecycleTarget,
  serve: (request: Request, pluginCtx: PluginContext) => Promise<void>,
): Promise<void> {
  const { res, requestId, pluginRunner, failureMessage } = target

  let request: Request
  try {
    request = target.source.toRequest()
  } catch (err) {
    // A request the adapter cannot represent is a 500, exactly as it was before these branches grew
    // a lifecycle — the conversion used to sit inside the handler's own try.
    sendError(res, 'INTERNAL', messageOf(err, failureMessage), 500, undefined, requestId)
    return
  }

  const pluginCtx: PluginContext = { request, response: res, ctx: {}, requestId }

  if (pluginRunner) {
    pluginRunner.applyDecorations(pluginCtx.ctx)
    const onRequest = await pluginRunner.runOnRequest(pluginCtx)
    // A hook that answered the request stops the pipeline — the same guarantee `executeRoute` gives.
    if (onRequest.shortCircuited) return
  }

  try {
    await serve(request, pluginCtx)
  } catch (err) {
    if (pluginRunner) await pluginRunner.runOnError(pluginCtx, err)
    sendError(res, 'INTERNAL', messageOf(err, failureMessage), 500, undefined, requestId)
  }

  // After the response is written, as `executeRoute` does — a hook here observes a completed turn.
  if (pluginRunner) await pluginRunner.runOnResponse(pluginCtx)
}
