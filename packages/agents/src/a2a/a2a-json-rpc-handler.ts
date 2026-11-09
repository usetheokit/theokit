/**
 * B-394 (OC-13) — serve A2A's JSON-RPC `message/send` over Web `Request`/`Response`.
 *
 * Transport only (ADR D1): this module owns the wire (auth order, body bound, JSON-RPC parsing,
 * error codes, the result shape) and its caller owns the agent and the secrets, through
 * `authorize` and `respond`. The pair to `createA2ATool({ protocol: 'jsonrpc' })`.
 *
 * Order: not POST → 405; `authorize` false → 401 with the body never read; a body over
 * `maxBodyBytes` → 413; a body still arriving at the deadline → 408; every other answer is HTTP 200
 * with a JSON-RPC 2.0 body. One deadline covers the read and the turn, and the handler answers
 * -32603 when it passes whether or not `respond` has settled.
 */

/** What the caller supplies: who may call, and the agent turn that answers. */
export interface A2AJsonRpcHandlerOptions {
  /** Decide from the raw `Authorization` header; false answers 401 before the body is read. */
  authorize(authorization: string | undefined): boolean
  /** Run one agent turn on the text of the message; abort when `signal` aborts. */
  respond(text: string, signal: AbortSignal): Promise<string>
  /** The largest body read, in bytes; one more answers 413. */
  maxBodyBytes: number
  /** One bound over reading the body and the turn, in milliseconds. */
  timeoutMs: number
}

type RpcId = string | number | null

const JSON_HEADERS = { 'content-type': 'application/json' }

const PARSE_ERROR = -32700
const INVALID_REQUEST = -32600
const METHOD_NOT_FOUND = -32601
const INVALID_PARAMS = -32602
const INTERNAL_ERROR = -32603

function rpcResult(id: RpcId, result: unknown): Response {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), { headers: JSON_HEADERS })
}

function rpcError(id: RpcId, code: number, message: string): Response {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }), {
    headers: JSON_HEADERS,
  })
}

/** Why a body read stopped short of a full body. */
type BodyRead = { ok: true; bytes: Uint8Array } | { ok: false; status: 400 | 408 | 413 }

/** Resolve when `signal` aborts; the returned `off` removes the listener. */
function abortOf(signal: AbortSignal): { aborted: Promise<void>; off: () => void } {
  let listener: (() => void) | undefined
  const aborted = new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve()
      return
    }
    listener = () => {
      resolve()
    }
    signal.addEventListener('abort', listener, { once: true })
  })
  const off = () => {
    if (listener) signal.removeEventListener('abort', listener)
  }
  return { aborted, off }
}

/**
 * Read through a call so a check after an `await` is not narrowed to the value it had before it:
 * the deadline can abort while the read waits.
 */
function hasAborted(signal: AbortSignal): boolean {
  return signal.aborted
}

/**
 * Read the body counting bytes as they arrive, never trusting `Content-Length`: over the bound
 * the stream is cancelled and the read answers 413; a deadline that passes mid-read answers 408;
 * a stream that errors answers 400.
 */
async function readBoundedBody(
  request: Request,
  maxBytes: number,
  deadline: AbortSignal,
): Promise<BodyRead> {
  if (!request.body) return { ok: true, bytes: new Uint8Array() }
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  const onAbort = () => {
    reader.cancel().catch(() => undefined)
  }
  deadline.addEventListener('abort', onAbort, { once: true })
  try {
    for (;;) {
      if (hasAborted(deadline)) return { ok: false, status: 408 }
      const { done, value } = await reader.read()
      if (hasAborted(deadline)) return { ok: false, status: 408 }
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined)
        return { ok: false, status: 413 }
      }
      chunks.push(value)
    }
  } catch {
    // A read the deadline cancelled is a timeout. Any other read failure is a body the client
    // broke off or sent malformed: answered 400 so the route never sees a rejected handler.
    return { ok: false, status: hasAborted(deadline) ? 408 : 400 }
  } finally {
    deadline.removeEventListener('abort', onAbort)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return { ok: true, bytes }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isRpcId(value: unknown): value is string | number {
  return typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))
}

/** The non-empty text parts of `params.message`, or undefined when there are none. */
function textPartsOf(params: unknown): string[] | undefined {
  if (!isRecord(params) || !isRecord(params.message)) return undefined
  const parts = params.message.parts
  if (!Array.isArray(parts)) return undefined
  const texts = parts.flatMap((part: unknown) =>
    isRecord(part) && part.kind === 'text' && typeof part.text === 'string' && part.text !== ''
      ? [part.text]
      : [],
  )
  return texts.length > 0 ? texts : undefined
}

/** Either the message text to answer, or the JSON-RPC error that answers instead. */
type Parsed = { ok: true; id: string | number; text: string } | { ok: false; response: Response }

function parseRequest(bytes: Uint8Array): Parsed {
  let body: unknown
  try {
    body = JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    return { ok: false, response: rpcError(null, PARSE_ERROR, 'parse error') }
  }
  if (!isRecord(body) || body.jsonrpc !== '2.0' || typeof body.method !== 'string') {
    return { ok: false, response: rpcError(null, INVALID_REQUEST, 'invalid request') }
  }
  if (!isRpcId(body.id)) {
    return { ok: false, response: rpcError(null, INVALID_REQUEST, 'invalid request') }
  }
  const id = body.id
  if (body.method !== 'message/send') {
    return {
      ok: false,
      response: rpcError(id, METHOD_NOT_FOUND, `method not found: ${body.method}`),
    }
  }
  const texts = textPartsOf(body.params)
  if (!texts) {
    return {
      ok: false,
      response: rpcError(id, INVALID_PARAMS, 'params.message holds no non-empty text part'),
    }
  }
  return { ok: true, id, text: texts.join('\n') }
}

/** Resolve on the next macrotask: every microtask already queued runs first. */
function nextMacrotask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

type TurnOutcome = { settled: true; reply: string } | { settled: false }

/**
 * Run `respond` once, raced against the deadline. When the deadline wins, the handler still waits
 * one macrotask, so a `respond` that had already resolved when the deadline fired (its promise chain
 * not yet flushed) is answered as a result: its caller's "answered" bookkeeping then matches what
 * was returned. One still pending after that keeps running; its later rejection is observed here
 * so it is never unhandled.
 */
async function runTurn(
  options: A2AJsonRpcHandlerOptions,
  id: string | number,
  text: string,
  deadline: AbortSignal,
): Promise<Response> {
  const turn: Promise<TurnOutcome> = Promise.resolve()
    .then(() => options.respond(text, deadline))
    .then(
      (reply) => ({ settled: true as const, reply }),
      () => ({ settled: false as const }),
    )
  const { aborted, off } = abortOf(deadline)
  let outcome: TurnOutcome | undefined
  try {
    outcome = await Promise.race([turn, aborted.then(() => undefined)])
    outcome ??= await Promise.race([turn, nextMacrotask().then(() => undefined)])
  } finally {
    off()
  }
  if (outcome?.settled) {
    return rpcResult(id, {
      kind: 'message',
      role: 'agent',
      messageId: crypto.randomUUID(),
      parts: [{ kind: 'text', text: outcome.reply }],
    })
  }
  if (outcome === undefined || hasAborted(deadline)) {
    return rpcError(
      id,
      INTERNAL_ERROR,
      `the agent turn ran out of time after ${options.timeoutMs} ms`,
    )
  }
  return rpcError(id, INTERNAL_ERROR, 'the agent turn failed')
}

async function handle(
  options: A2AJsonRpcHandlerOptions,
  request: Request,
  deadline: AbortSignal,
): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(null, { status: 405, headers: { allow: 'POST' } })
  }
  if (!options.authorize(request.headers.get('authorization') ?? undefined)) {
    return new Response(null, { status: 401, headers: { 'www-authenticate': 'Bearer' } })
  }
  const read = await readBoundedBody(request, options.maxBodyBytes, deadline)
  if (!read.ok) return new Response(null, { status: read.status })
  const parsed = parseRequest(read.bytes)
  if (!parsed.ok) return parsed.response
  return runTurn(options, parsed.id, parsed.text, deadline)
}

/** Build the `message/send` handler. Each call keeps its own state; nothing is shared. */
export function createA2AJsonRpcHandler(
  options: A2AJsonRpcHandlerOptions,
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    // Created on entry so one bound covers the body read and the turn.
    // A plain controller and timer, not AbortSignal.any + AbortSignal.timeout: on Node 22.12 that
    // composite signal can be collected before its unref'd timer fires, so it never aborted.
    const controller = new AbortController()
    const abort = () => {
      controller.abort()
    }
    const timer = setTimeout(abort, options.timeoutMs)
    if (request.signal.aborted) abort()
    else request.signal.addEventListener('abort', abort, { once: true })
    const deadline = controller.signal
    try {
      return await handle(options, request, deadline)
    } finally {
      clearTimeout(timer)
      request.signal.removeEventListener('abort', abort)
    }
  }
}
