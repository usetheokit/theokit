/**
 * Who is asking, on the Node dispatch path that serves the agent endpoints
 * (usetheokit/theokit#365).
 *
 * `executeRoute` answers this with `subjectFromContext(ctx)`, where `ctx` is the run context built
 * from the application's `server/context.ts` plus plugin decorations. The agent branches build no
 * such context — which is why `mountAgent`'s `subject` option had nowhere to come from and every
 * caller left it out. This builds the same context from the same two sources, so the agent surface
 * reads identity from the seam the routes already read it from rather than from a second one.
 *
 * ## Why it returns a resolver instead of a subject
 *
 * `tryServeAgentAux` runs for EVERY url, including the ones it does not own. Resolving eagerly
 * there would execute the application's `createContext` twice on every route request — once in the
 * aux branch that falls through, once in the route executor. So callers get a memoized thunk and
 * invoke it only on a path they are about to answer, which is the same discipline theokit#400
 * imposed on `source.toRequest()` for the same dispatcher.
 *
 * Callers on the Node path MUST invoke it before converting the request to a Web `Request`:
 * the conversion drains the Node readable, and `createContext` receives the Node `req`.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'

import { subjectFromContext, type RouteSubject } from '../../core/contracts/route-policy.js'
import type { PluginRunner } from '../plugins/plugin-runner.js'
import type { LoadModule } from '../scan/module-loader.js'

import { createServerContext } from './middleware-runner.js'

/** What {@link createAgentSubjectResolver} needs in order to build the run context. */
export interface AgentSubjectSources {
  req: IncomingMessage
  res: ServerResponse
  loadModule: LoadModule
  /** The app's `server/` directory. Absent ⇒ there is no `context.ts` to consult. */
  serverDir: string | undefined
  pluginRunner: PluginRunner | undefined
}

/**
 * Build a memoized resolver for the caller's identity.
 *
 * Decorations are applied ON TOP of the factory's result, matching `executeRoute`: a plugin
 * decoration wins only where `context.ts` did not set the same key.
 *
 * A `createContext` that throws is not swallowed — an application whose identity resolution is
 * broken must not be treated as an anonymous caller, because that reads as a clean refusal and
 * hides the fault. The throw reaches the branch's own error handler and becomes a 500.
 */
export function createAgentSubjectResolver(
  sources: AgentSubjectSources,
): () => Promise<RouteSubject | null> {
  let pending: Promise<RouteSubject | null> | undefined
  return () => {
    pending ??= resolve(sources)
    return pending
  }
}

async function resolve(sources: AgentSubjectSources): Promise<RouteSubject | null> {
  const { req, res, loadModule, serverDir, pluginRunner } = sources
  const produced =
    serverDir === undefined ? {} : await createServerContext(req, res, loadModule, serverDir)
  const ctx = (produced ?? {}) as Record<string, unknown>
  pluginRunner?.applyDecorations(ctx)
  return subjectFromContext(ctx)
}
