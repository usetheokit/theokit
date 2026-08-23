/**
 * What an application's `createContext` can read when the agent surface resolves identity
 * (usetheokit/theokit#415).
 *
 * The resolver's docstring stated a MUST none of its callers could honour — "invoke it before
 * converting the request to a Web `Request`" — while the laziness argued for in the same comment is
 * what makes that impossible: the invocation happens inside the handler, and the handler is entered
 * after `serveThroughPluginLifecycle` has already converted. `incomingMessageToWebRequest` attaches
 * the Node readable AS the request body, so the stream is consumed by then.
 *
 * The contract is stated honestly now, and this pins it so the prose cannot drift back: headers and
 * cookies reach `createContext`; the body does not.
 */
// #418 — the PRODUCT loads user `.ts` through `importUserModule`, whose tsx fallback is what
// makes it work below Node 22.18. A harness calling `import()` directly tests a path the
// framework never takes, and fails on the version `engines` declares.
import { makeFixtureProject } from '../lib/fixture-project.js'
import { importUserModule } from '../../packages/theo/src/config/import-user-module.js'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createAgentSubjectResolver } from '../../packages/theo/src/server/http/resolve-agent-subject.js'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** An app whose `server/context.ts` resolves identity from a header, the common case. */
function projectWithContext(source: string): string {
  const dir = makeFixtureProject('theo-subject-')
  dirs.push(dir)
  writeFileSync(join(dir, 'context.ts'), source, 'utf8')
  return dir
}

/** A Node request whose body stream has ALREADY been consumed, which is the real state here. */
function drainedRequest(headers: Record<string, string>): IncomingMessage {
  return {
    headers,
    method: 'POST',
    url: '/api/agents/support',
    // A consumed readable: `end` has already fired, so a reader waits forever or reads nothing.
    on: (event: string, cb: (...args: unknown[]) => void) => {
      if (event === 'end') queueMicrotask(() => cb())
    },
    once: () => undefined,
    off: () => undefined,
  } as unknown as IncomingMessage
}

const RES = { setHeader: () => undefined, getHeader: () => undefined } as unknown as ServerResponse

describe('agent identity reads what survives the conversion (#415)', () => {
  it('reaches a subject resolved from a header', async () => {
    const serverDir = projectWithContext(
      `export function createContext({ request }) {
         const id = request.headers['x-user-id']
         return id ? { subject: { id } } : {}
       }`,
    )

    const resolve = createAgentSubjectResolver({
      req: drainedRequest({ 'x-user-id': 'u-42' }),
      res: RES,
      loadModule: importUserModule,
      serverDir,
      pluginRunner: undefined,
    })

    expect((await resolve())?.id).toBe('u-42')
  })

  it('is memoised, so the app context is built once per request', async () => {
    // The reason the resolver is a thunk at all: `tryServeAgentAux` runs for EVERY url, and eager
    // resolution would run the application's `createContext` twice on every route request.
    const serverDir = projectWithContext(
      `let calls = 0
       export function createContext() {
         calls += 1
         return { subject: { id: 'u-' + String(calls) } }
       }`,
    )

    const resolve = createAgentSubjectResolver({
      req: drainedRequest({}),
      res: RES,
      loadModule: importUserModule,
      serverDir,
      pluginRunner: undefined,
    })

    const first = await resolve()
    const second = await resolve()

    expect(first?.id).toBe('u-1')
    expect(second?.id).toBe('u-1')
  })

  it('an app with no context.ts resolves to no subject rather than to an error', async () => {
    const resolve = createAgentSubjectResolver({
      req: drainedRequest({ 'x-user-id': 'u-42' }),
      res: RES,
      loadModule: importUserModule,
      serverDir: undefined,
      pluginRunner: undefined,
    })

    // Absent means "no identity was established", never "anyone" — the caller branches on it.
    expect(await resolve()).toBeNull()
  })

  it('does not swallow a createContext that throws', async () => {
    // An application whose identity resolution is broken must not be treated as an anonymous
    // caller: that reads as a clean refusal and hides the fault.
    const serverDir = projectWithContext(
      `export function createContext() { throw new Error('identity backend down') }`,
    )

    const resolve = createAgentSubjectResolver({
      req: drainedRequest({}),
      res: RES,
      loadModule: importUserModule,
      serverDir,
      pluginRunner: undefined,
    })

    await expect(resolve()).rejects.toThrow(/identity backend down/u)
  })
})
