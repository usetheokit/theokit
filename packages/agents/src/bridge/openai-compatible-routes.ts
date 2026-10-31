/**
 * An OpenAI-compatible surface over a `complete` port — Web Standard, like the agent route
 * generator: `GET /v1/models` and a non-streaming `POST /v1/chat/completions`. The handler knows
 * nothing about the agent that answers; the caller passes `complete`, which turns one parsed request
 * into the assistant's text (plan D1). Errors follow the OpenAI shape `{error:{message,type,param,code}}`.
 */
import { randomUUID } from 'node:crypto'

import { z } from 'zod'

import { BodyTooLargeError, MAX_REQUEST_BODY_BYTES, readCappedBody } from './read-capped-body.js'

const MODELS_PATH = '/v1/models'
const COMPLETIONS_PATH = '/v1/chat/completions'

/** One text part of a message whose `content` is an array. */
export interface OpenAITextPart {
  readonly type: 'text'
  readonly text: string
}

export interface OpenAIChatMessage {
  readonly role: 'system' | 'developer' | 'user' | 'assistant'
  readonly content: string | readonly OpenAITextPart[]
}

/** The part of a chat completion request the handler reads; every other parameter is ignored. */
export interface OpenAIChatRequest {
  readonly model: string
  readonly messages: readonly OpenAIChatMessage[]
}

export interface OpenAICompatibleRoutesOptions {
  /** The model ids `/v1/models` lists and a chat request may name, in order. */
  readonly models: readonly string[]
  /** One request in, the assistant's text out; a rejection answers 502 `turn_failed`. */
  readonly complete: (request: OpenAIChatRequest) => Promise<string>
}

function isTextPart(part: unknown): part is OpenAITextPart {
  const candidate = part as { type?: unknown; text?: unknown } | null
  return (
    typeof candidate === 'object' &&
    candidate !== null &&
    candidate.type === 'text' &&
    typeof candidate.text === 'string'
  )
}

/**
 * A non-strict object: the extra parameters every OpenAI client may send (`temperature`,
 * `max_tokens`, `n`, `user`) are ignored, not refused (EC-1).
 */
const CHAT_BODY = z.object({
  model: z.string().min(1),
  stream: z.boolean().optional(),
  messages: z
    .array(
      z.object({
        role: z.enum(['system', 'developer', 'user', 'assistant']),
        content: z.union([
          z.string(),
          z.array(
            z.custom<OpenAITextPart>(isTextPart, {
              message: 'only text content parts are supported',
            }),
          ),
        ]),
      }),
    )
    .min(1),
})

type Issue = z.core.$ZodIssue

/** The path of an issue; for a union, the branch that got furthest, so a bad part names its index. */
function issuePath(issue: Issue): PropertyKey[] {
  if (issue.code !== 'invalid_union') return issue.path
  let deepest: Issue | undefined
  for (const [first] of issue.errors) {
    if (deepest === undefined || first.path.length > deepest.path.length) deepest = first
  }
  return deepest === undefined ? issue.path : [...issue.path, ...issuePath(deepest)]
}

function openAIError(
  status: number,
  type: string,
  message: string,
  param: string | null = null,
  headers?: HeadersInit,
): Response {
  return Response.json(
    { error: { message, type, param, code: null } },
    { status, ...(headers === undefined ? {} : { headers }) },
  )
}

function textOf(message: OpenAIChatMessage): string {
  return typeof message.content === 'string'
    ? message.content
    : message.content.map((part) => part.text).join('\n')
}

/**
 * The prompt a chat request becomes: a lone user message verbatim, otherwise one `role: text`
 * line per message, separated by a blank line (FR-012).
 */
export function renderTranscript(messages: readonly OpenAIChatMessage[]): string {
  const only = messages.length === 1 ? messages[0] : undefined
  if (only?.role === 'user') return textOf(only)
  return messages.map((message) => `${message.role}: ${textOf(message)}`).join('\n\n')
}

/** The parsed JSON body, or the response that refuses it (413 past the cap, 400 when unreadable). */
async function readJson(request: Request): Promise<unknown> {
  try {
    const bytes = await readCappedBody(request, MAX_REQUEST_BODY_BYTES)
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown
  } catch (error) {
    if (error instanceof BodyTooLargeError) {
      return openAIError(413, 'body_too_large', error.message, null, { connection: 'close' })
    }
    return openAIError(400, 'invalid_body', 'the request body is not JSON')
  }
}

/** The chat request, or the response that refuses it before any model turn runs. */
async function parseChat(
  request: Request,
  models: readonly string[],
): Promise<OpenAIChatRequest | Response> {
  const raw = await readJson(request)
  if (raw instanceof Response) return raw
  const parsed = CHAT_BODY.safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return openAIError(400, 'invalid_body', issue.message, issuePath(issue).map(String).join('.'))
  }
  if (parsed.data.stream === true)
    return openAIError(400, 'stream_unsupported', 'stream: true is not supported', 'stream')
  if (!models.includes(parsed.data.model)) {
    return openAIError(
      404,
      'model_not_found',
      `the model ${parsed.data.model} is not served here`,
      'model',
    )
  }
  return { model: parsed.data.model, messages: parsed.data.messages }
}

function completion(model: string, content: string): Response {
  return Response.json({
    id: `chatcmpl-${randomUUID()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
  })
}

async function chatCompletion(
  request: Request,
  options: OpenAICompatibleRoutesOptions,
): Promise<Response> {
  const parsed = await parseChat(request, options.models)
  if (parsed instanceof Response) return parsed
  let content: string
  try {
    content = await options.complete(parsed)
  } catch {
    // The caller's `complete` logs its own failure; the client learns only that the turn failed,
    // never the provider's message (FR-007).
    return openAIError(502, 'turn_failed', 'the model turn failed')
  }
  return completion(parsed.model, content)
}

function listModels(models: readonly string[]): Response {
  return Response.json({
    object: 'list',
    data: models.map((id) => ({ id, object: 'model', created: 0, owned_by: 'theokit' })),
  })
}

function methodNotAllowed(allow: string): Response {
  return openAIError(405, 'method_not_allowed', `use ${allow}`, null, { allow })
}

/**
 * `GET /v1/models` and `POST /v1/chat/completions`; another method on either path is 405, and any
 * other path answers `undefined`, so the caller can try its next handler (FR-001). A chat request is
 * checked in order: size (413), JSON (400), shape (400 `invalid_body`, `param` naming the first
 * issue), `stream: true` (400 `stream_unsupported`), model (404 `model_not_found`), then `complete`.
 */
export function createOpenAICompatibleRoutes(
  options: OpenAICompatibleRoutesOptions,
): (request: Request) => Promise<Response | undefined> {
  return async (request) => {
    const { pathname } = new URL(request.url)
    if (pathname === MODELS_PATH)
      return request.method === 'GET' ? listModels(options.models) : methodNotAllowed('GET')
    if (pathname !== COMPLETIONS_PATH) return undefined
    return request.method === 'POST' ? chatCompletion(request, options) : methodNotAllowed('POST')
  }
}
