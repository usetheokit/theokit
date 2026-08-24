import type { IncomingMessage } from 'node:http'
import { basename } from 'node:path'

import Busboy from 'busboy'

// --- Types ---

export interface UploadedFile {
  fieldname: string
  filename: string
  encoding: string
  mimeType: string
  buffer: Buffer
  size: number
}

export interface ParsedBody {
  fields: Record<string, string>
  files: UploadedFile[]
  json?: unknown
}

export interface BodyParserOptions {
  maxFileSize?: number // bytes, default 10MB
  maxFiles?: number // default 10
  maxFieldSize?: number // bytes, default 1MB
}

const METHODS_WITH_BODY = new Set(['POST', 'PUT', 'PATCH'])

const DEFAULT_MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB
const DEFAULT_MAX_FILES = 10
const DEFAULT_MAX_FIELD_SIZE = 1 * 1024 * 1024 // 1MB

/**
 * theokit#400 — the request body was consumed before the parser could read it.
 *
 * A Node `IncomingMessage` is a single-use stream. Once something drains it, `'end'` has fired and
 * cannot fire again, so a parser that attaches its listeners afterwards waits for an event that
 * will never come: the request hangs with no status, no error, and no timeout — the failure family
 * of `docs/adr/0002`, in its least readable form, since nothing terminates at all.
 *
 * That is a framework bug wherever it happens (a dispatcher converting the request before deciding
 * it owns the path, a middleware reading the stream and not passing the value on), so this reports
 * it by name instead of waiting. A 500 that says which request lost its body is recoverable
 * information; silence is not.
 */
export class RequestBodyConsumedError extends Error {
  readonly code = 'REQUEST_BODY_CONSUMED'
  readonly status = 500
  constructor(method: string, url: string | undefined) {
    super(
      `Request body for ${method} ${url ?? '(unknown url)'} was already consumed before the body ` +
        `parser ran, so it can never arrive. Something upstream read the request stream — a route ` +
        `dispatcher, a middleware, or an adapter that converted the request — without passing the ` +
        `parsed body on.`,
    )
    this.name = 'RequestBodyConsumedError'
  }
}

/**
 * Was the request declared to carry no bytes at all? `content-length: 0` is the one case where an
 * already-ended stream is honestly empty rather than eaten, and it must stay an `undefined` body
 * instead of an error — an empty POST is legal.
 */
function declaresEmptyBody(req: IncomingMessage): boolean {
  return (req.headers['content-length'] ?? '') === '0'
}

/**
 * True once the stream has emitted `'end'` — which, at the moment the parser is about to attach,
 * means somebody else drained it. A stream nobody has read yet reports `false` here even when Node
 * has already buffered every byte, because `'end'` only fires on consumption.
 *
 * Read as a plain truthiness check on purpose: the type says `boolean`, but the suite's request
 * doubles are plain emitters carrying `headers` and no `readableEnded` at all, and `undefined` must
 * take the untouched-stream path exactly as `false` does.
 */
function bodyAlreadyConsumed(req: IncomingMessage): boolean {
  return req.readableEnded && !declaresEmptyBody(req)
}

export class FileTooLargeError extends Error {
  readonly code = 'FILE_TOO_LARGE'
  readonly status = 413
  constructor(
    message: string,
    readonly truncatedFilenames: string[],
    readonly maxFileSize: number,
  ) {
    super(message)
    this.name = 'FileTooLargeError'
  }
}

// --- JSON parsing ---

/**
 * Stash the parsed body on the IncomingMessage for the devtools forwarder
 * to read at log time. Symbol-keyed so it never leaks into user-visible
 * surfaces. Best-effort — failures (e.g. frozen req) are swallowed.
 */
function stashBodyPreview(req: IncomingMessage, body: unknown): void {
  try {
    ;(req as unknown as Record<symbol, unknown>)[DEVTOOLS_BODY_PREVIEW] = body
  } catch {
    // best-effort; never break the request
  }
}

function parseJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    // theokit#400 — an ended stream re-emits nothing, so attaching here would wait forever. A
    // declared-empty body resolves as the absent body it is; anything else was eaten upstream and
    // is reported rather than awaited.
    if (req.readableEnded) {
      if (declaresEmptyBody(req)) {
        resolve(undefined)
        return
      }
      reject(new RequestBodyConsumedError(req.method ?? 'POST', req.url))
      return
    }
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString()
      if (!raw) {
        resolve(undefined)
        return
      }
      try {
        resolve(JSON.parse(raw))
      } catch {
        reject(new Error('Invalid JSON body'))
      }
    })
    req.on('error', reject)
  })
}

// --- Multipart parsing ---

function parseMultipartBody(
  req: IncomingMessage,
  contentType: string,
  options: Required<Pick<BodyParserOptions, 'maxFileSize' | 'maxFiles' | 'maxFieldSize'>>,
): Promise<{ fields: Record<string, string>; files: UploadedFile[] }> {
  // EC-3: Validate boundary exists.
  if (!contentType.includes('boundary=')) {
    return Promise.reject(new Error('Missing multipart boundary'))
  }

  // theokit#400 — the multipart arm fails differently and no better. Piping an already-drained
  // stream into busboy rejects with `Unexpected end of form` (measured), which
  // `parseQueryAndBody` maps to a 400 VALIDATION_ERROR: the caller is told to fix a request that
  // was correct, and the framework's own mistake reads as theirs. Same cause, so the same name.
  if (bodyAlreadyConsumed(req)) {
    return Promise.reject(new RequestBodyConsumedError(req.method ?? 'POST', req.url))
  }

  return new Promise((resolve, reject) => {
    const fields: Record<string, string> = {}
    const files: UploadedFile[] = []
    // CR-010: track filenames that were truncated mid-stream. The previous
    // implementation skipped truncated files from `files` and relied on
    // `files.some(f => f.size > maxFileSize)` to detect — but since the
    // file was never added, the guard never fired. Silent data loss.
    const truncatedFilenames: string[] = []
    let fileCount = 0

    const bb = Busboy({
      headers: req.headers,
      limits: {
        fileSize: options.maxFileSize,
        files: options.maxFiles,
        fieldSize: options.maxFieldSize,
      },
    })

    bb.on('field', (name: string, value: string) => {
      fields[name] = value
    })

    bb.on(
      'file',
      (
        fieldname: string,
        stream: NodeJS.ReadableStream,
        info: { filename: string; encoding: string; mimeType: string },
      ) => {
        fileCount++
        if (fileCount > options.maxFiles) {
          stream.resume() // drain
          return
        }

        // EC-6: Sanitize filename — basename only, no path traversal.
        const safeName = basename(info.filename || 'unnamed')
        const chunks: Buffer[] = []
        let size = 0
        let truncated = false

        stream.on('data', (chunk: Buffer) => {
          size += chunk.length
          if (size > options.maxFileSize) {
            truncated = true
            stream.resume() // drain the rest
            return
          }
          chunks.push(chunk)
        })

        stream.on('end', () => {
          if (truncated) {
            truncatedFilenames.push(safeName)
            return
          }

          const buffer = Buffer.concat(chunks)
          files.push({
            fieldname,
            filename: safeName,
            encoding: info.encoding,
            mimeType: info.mimeType,
            buffer,
            size: buffer.length,
          })
        })
      },
    )

    bb.on('filesLimit', () => {
      reject(new Error(`Too many files. Maximum: ${options.maxFiles}`))
    })

    bb.on('error', (err: Error) => {
      reject(err)
    })

    bb.on('close', () => {
      if (truncatedFilenames.length > 0) {
        reject(
          new FileTooLargeError(
            `File too large (max ${options.maxFileSize} bytes): ${truncatedFilenames.join(', ')}`,
            truncatedFilenames,
            options.maxFileSize,
          ),
        )
        return
      }
      resolve({ fields, files })
    })

    req.pipe(bb)
  })
}

// --- Main parser ---

/**
 * Symbol-keyed slot on IncomingMessage that the devtools request log
 * forwarder reads to enrich the broadcast payload with a body preview.
 * Symbol-keyed so it can't collide with user-land props and is invisible
 * to JSON.stringify / iteration. Always optional — readers must guard.
 */
export const DEVTOOLS_BODY_PREVIEW = Symbol('theo:devtools:bodyPreview')

export async function parseRequestBody(
  req: IncomingMessage,
  options?: BodyParserOptions,
): Promise<ParsedBody> {
  const method = req.method?.toUpperCase() ?? 'GET'
  if (!METHODS_WITH_BODY.has(method)) {
    return { fields: {}, files: [], json: undefined }
  }

  const contentType = req.headers['content-type'] ?? ''

  // JSON
  if (contentType.includes('application/json')) {
    const json = await parseJsonBody(req)
    stashBodyPreview(req, json)
    return { fields: {}, files: [], json }
  }

  // Multipart
  if (contentType.includes('multipart/form-data')) {
    const limits = {
      maxFileSize: options?.maxFileSize ?? DEFAULT_MAX_FILE_SIZE,
      maxFiles: options?.maxFiles ?? DEFAULT_MAX_FILES,
      maxFieldSize: options?.maxFieldSize ?? DEFAULT_MAX_FIELD_SIZE,
    }
    const { fields, files } = await parseMultipartBody(req, contentType, limits)
    stashBodyPreview(req, {
      fields,
      files: files.map((f) => ({
        fieldname: f.fieldname,
        filename: f.filename,
        mimeType: f.mimeType,
        size: f.size,
      })),
    })
    return { fields, files }
  }

  // No body or empty
  if (!contentType) {
    return { fields: {}, files: [] }
  }

  // Unsupported content type
  throw new Error(`Unsupported Content-Type: ${contentType}`)
}
