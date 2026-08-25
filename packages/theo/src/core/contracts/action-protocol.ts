/**
 * Action protocol — cross-boundary contract for `defineAction` + `useAction`.
 *
 * Per plan g3-server-actions-and-useaction v1.2 § Phase 0 / T0.1, ADRs D1 (encoding)
 * + D6 (full dot-notation path) + D7 (PII mask) — types and runtime referenced
 * by server (`server/http/action-execute.ts`, `server/define/define-action.ts`)
 * and client (`client/use-action.ts`, `vite-plugin/actions-virtual-module`).
 *
 * That client pointer named `@theokit/react/useAction` until #453 — a package published outside
 * this repository, with one version and a `@theokit/sdk ^1.1.0` peer against a published 4.x. The
 * hook lives beside the contract now, in `theokit/client`.
 *
 * Lives in `core/contracts/` per architecture.md v3.1 exception — cross-module
 * deep imports ALLOWED for this file. Core depends on NOTHING intra-monorepo;
 * `extractUniversalIssues` is implemented INLINE (NOT imported from `@theokit/sdk`)
 * to honor dep-cruiser `core-depends-on-nothing` invariant (EC-1 absorbed).
 *
 * Field-key convention (D6 + EC-13): dot-notation full path. Nested objects use
 * `'user.address.zip'`; array indices use `'items.0.name'` (NOT bracket
 * `'items[0].name'`). Root-level errors (path = []) use empty string `''`
 * (EC-7). Consumers needing bracket notation can write a small `dotToBracket`
 * helper in userland.
 */

import type { TheoErrorCode, TheoErrorEnvelope, ValidationFieldsExt } from './error-envelope.js'

/**
 * HTTP-status mapping per IANA HTTP Status Code Registry (subset relevant to
 * action surface). VALIDATION_ERROR → 422 is preferred over Astro's BAD_REQUEST/400
 * (more semantic for input-shape mismatch). PAYLOAD_TOO_LARGE → 413 covers EC-3
 * (response-side size limit; request-side reuses standard 413).
 */
export type ActionErrorCode =
  | 'VALIDATION_ERROR'
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'METHOD_NOT_ALLOWED'
  | 'CONFLICT'
  | 'CONTENT_TOO_LARGE'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'TOO_MANY_REQUESTS'
  | 'INTERNAL_SERVER_ERROR'

const CODE_TO_STATUS: Record<ActionErrorCode, number> = {
  VALIDATION_ERROR: 422,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  CONFLICT: 409,
  CONTENT_TOO_LARGE: 413,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
}

const STATUS_TO_CODE: Record<number, ActionErrorCode> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  422: 'VALIDATION_ERROR',
  429: 'TOO_MANY_REQUESTS',
  500: 'INTERNAL_SERVER_ERROR',
}

/**
 * Universal zod issue shape covering BOTH v3 (`z.ZodIssue`) and v4 (`$ZodIssue`).
 * Duck-typed minimum surface: `{path, message}`. Implemented per EC-1 absorbed —
 * consumers chain may ship either zod major; constructor accepts `unknown` and
 * normalizes via `extractUniversalIssues`.
 */
export interface UniversalZodIssue {
  readonly path: readonly (string | number)[]
  readonly message: string
  readonly code?: string
}

/**
 * `ActionError` — general server-side action failure. Discriminator `type` is
 * literal `'TheoActionError'`; used by `ActionError.fromJson` to distinguish
 * from `ActionInputError`.
 */
export class ActionError extends Error {
  // Discriminator widened to the full union so subclasses can narrow to their
  // specific literal (TypeScript would otherwise reject the override). Concrete
  // values are still always exact literals at runtime.
  readonly type: 'TheoActionError' | 'TheoActionInputError' = 'TheoActionError'
  readonly code: ActionErrorCode
  readonly status: number

  constructor(params: { code: ActionErrorCode; message?: string; stack?: string }) {
    super(params.message ?? params.code)
    this.code = params.code
    this.status = ActionError.codeToStatus(params.code)
    if (params.stack) {
      this.stack = params.stack
    }
  }

  /**
   * G5 T2.4 — canonical envelope view of the action error. Maps the G3
   * ActionErrorCode to a canonical TheoErrorCode (VALIDATION_ERROR ↔
   * UNPROCESSABLE_ENTITY, CONTENT_TOO_LARGE ↔ PAYLOAD_TOO_LARGE) so consumer
   * UI / SDK code can switch on the unified envelope.
   *
   * Subclasses override to populate `ext` (see `ActionInputError.envelope`).
   */
  get envelope(): TheoErrorEnvelope {
    return {
      code: ActionError.toTheoErrorCode(this.code),
      message: this.message,
    }
  }

  /**
   * Translate G3 ActionErrorCode → canonical TheoErrorCode (blueprint
   * Recommendations § "G3 ActionError becomes inaugural envelope user").
   */
  static toTheoErrorCode(code: ActionErrorCode): TheoErrorCode {
    if (code === 'VALIDATION_ERROR') return 'UNPROCESSABLE_ENTITY'
    if (code === 'CONTENT_TOO_LARGE') return 'PAYLOAD_TOO_LARGE'
    // The other ActionErrorCode members (BAD_REQUEST/UNAUTHORIZED/FORBIDDEN/
    // NOT_FOUND/METHOD_NOT_ALLOWED/CONFLICT/PAYLOAD_TOO_LARGE/
    // UNSUPPORTED_MEDIA_TYPE/TOO_MANY_REQUESTS/INTERNAL_SERVER_ERROR) are
    // identical strings in TheoErrorCode. Narrow via a type predicate
    // instead of assertion.
    return code
  }

  static codeToStatus(code: ActionErrorCode): number {
    return CODE_TO_STATUS[code]
  }

  static statusToCode(status: number): ActionErrorCode {
    return STATUS_TO_CODE[status] ?? 'INTERNAL_SERVER_ERROR'
  }

  /**
   * Parse a serialized error JSON back into the typed class hierarchy.
   * Distinguishes `TheoActionInputError` (with `issues` array) from
   * `TheoActionError` via the `type` discriminator. Falls back to
   * `INTERNAL_SERVER_ERROR` for malformed bodies (non-object, missing
   * `type`, unknown `code`).
   */
  static fromJson(body: unknown): ActionError {
    if (typeof body !== 'object' || body === null) {
      return new ActionError({ code: 'INTERNAL_SERVER_ERROR' })
    }
    const obj = body as Record<string, unknown>
    if (obj.type === 'TheoActionInputError' && Array.isArray(obj.issues)) {
      return new ActionInputError(obj.issues as unknown[])
    }
    if (
      obj.type === 'TheoActionError' &&
      typeof obj.code === 'string' &&
      obj.code in CODE_TO_STATUS
    ) {
      return new ActionError({
        code: obj.code as ActionErrorCode,
        message: typeof obj.message === 'string' ? obj.message : undefined,
      })
    }
    return new ActionError({ code: 'INTERNAL_SERVER_ERROR' })
  }
}

/**
 * `ActionInputError` — validation failure with field-level mapping.
 *
 * `fields` is auto-derived from `issues`: for each issue, key = full
 * dot-notation path (`'user.address.zip'`; root-level `path:[]` → `''`;
 * array indices as numeric segments → `'items.0.name'`). Multiple messages
 * for the same key accumulate; duplicate (path, message) tuples are deduped.
 */
export class ActionInputError extends ActionError {
  override readonly type = 'TheoActionInputError' as const
  readonly issues: readonly UniversalZodIssue[]
  readonly fields: Record<string, string[]>

  constructor(rawIssues: unknown) {
    super({ code: 'VALIDATION_ERROR', message: 'Validation failed' })
    this.issues = extractUniversalIssues(rawIssues)
    this.fields = buildFieldsMap(this.issues)
  }

  /**
   * G5 T2.4 — envelope view with ValidationFieldsExt populated from .fields.
   * UI consumers can `switch (env.code)` on `UNPROCESSABLE_ENTITY` and read
   * `(env.ext as ValidationFieldsExt).fields` for field-level rendering.
   */
  override get envelope(): TheoErrorEnvelope<ValidationFieldsExt> {
    return {
      code: 'UNPROCESSABLE_ENTITY',
      message: this.message,
      ext: { fields: this.fields },
    }
  }
}

function buildFieldsMap(issues: readonly UniversalZodIssue[]): Record<string, string[]> {
  const fields: Record<string, string[]> = {}
  const seen = new Set<string>()
  for (const issue of issues) {
    // EC-7: root path → empty string key. EC-8: numeric segments preserved as strings.
    const key = issue.path.length === 0 ? '' : issue.path.join('.')
    // `\u0000` as an escape, not the byte itself. NUL is the right separator — it cannot occur
    // in a path or a message — but a literal one makes the whole file `binary` to `grep`, which
    // then reports "binary file matches" instead of the matching lines. This file was silently
    // absent from every grep over `src/` because of it, including the no-`any` type audit.
    // The runtime string is identical.
    const dedupeKey = `${key}\u0000${issue.message}`
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)
    const bucket = fields[key] ?? []
    bucket.push(issue.message)
    fields[key] = bucket
  }
  return fields
}

/**
 * Normalize zod v3 (`z.ZodIssue`) and v4 (`$ZodIssue`) raw issues to
 * `UniversalZodIssue[]` (EC-1 absorbed). Duck-typed on `{path, message}` —
 * does NOT import zod types (`core/contracts/` depends on no intra-monorepo
 * + zod is consumer-controlled across the boundary).
 *
 * Silently skips entries missing required fields or shape mismatches; returns
 * empty array on non-array input.
 */
export function extractUniversalIssues(raw: unknown): UniversalZodIssue[] {
  if (!Array.isArray(raw)) return []
  const out: UniversalZodIssue[] = []
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue
    const obj = entry as Record<string, unknown>
    if (!Array.isArray(obj.path)) continue
    if (typeof obj.message !== 'string') continue
    // Path entries must be string or number
    const path: (string | number)[] = []
    let pathValid = true
    for (const seg of obj.path) {
      if (typeof seg === 'string' || typeof seg === 'number') {
        path.push(seg)
      } else {
        pathValid = false
        break
      }
    }
    if (!pathValid) continue
    out.push({
      path,
      message: obj.message,
      code: typeof obj.code === 'string' ? obj.code : undefined,
    })
  }
  return out
}

/**
 * Type guard for `ActionError` (and its subclass `ActionInputError`). True
 * iff the value is an instance of `ActionError`. Use `isInputError` to
 * narrow specifically to validation failures.
 */
export function isActionError(value: unknown): value is ActionError {
  return value instanceof ActionError
}

/**
 * Type guard narrowing to `ActionInputError`. Requires `instanceof` check
 * (not duck-typing on `type`) to prevent attacker-controlled JSON from
 * being mistaken for a real error instance.
 */
export function isInputError(value: unknown): value is ActionInputError {
  return value instanceof ActionInputError
}

/**
 * `ActionResult<TData, TError>` — discriminated union returned by client-side
 * action invocation. Either `{data, error: undefined}` (success) or
 * `{data: undefined, error}` (failure). Mirrors Astro `SafeResult` shape.
 */
export type ActionResult<TData = unknown, TError extends ActionError = ActionError> =
  | { data: TData; error: undefined }
  | { data: undefined; error: TError }

/**
 * `SerializedActionResult` — wire-shape emitted by `serializeActionResult`
 * in `server/http/serialize-action-result.ts` (T1.3). Discriminator `type`
 * distinguishes data (devalue-encoded), error (JSON), and empty (204) cases.
 */
export type SerializedActionResult =
  | {
      type: 'data'
      status: number
      contentType: 'application/json+devalue'
      body: string
    }
  | {
      type: 'error'
      status: number
      contentType: 'application/json'
      body: string
    }
  | { type: 'empty'; status: 204 }

/**
 * `ActionManifestEntry` — per-action metadata emitted by `action-scan.ts`
 * (T1.4) into `.theokit/actions-manifest.json`. Consumed by virtual module
 * `@theo/actions` (T3.1) and G4 devtools "Actions" tab (T5.1).
 */
export interface ActionManifestEntry {
  readonly name: string
  readonly filePath: string
  readonly urlPath: string
  readonly accept: 'form' | 'json'
  readonly hasInput: boolean
}
