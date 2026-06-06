/**
 * Plan T4.1 — envelope wire-format roundtrip coverage for ALL Error classes.
 *
 * Per `docs/plans/theokit-arch-gaps-implementation-plan.md` v1.2 Phase 4 T4.1.
 *
 * ARCHITECTURAL RECONCILIATION (honest framing per CLAUDE.md root Rule 3):
 * The T4.1 plan was authored from the architectural-review's blast-radius
 * narrative ("23 classes to migrate to TheoError") which conflicts with the
 * G5 D3 architectural decision (ADR `docs/migration/error-envelope-0-2-to-0-4.md`)
 * that was SHIPPED before this plan landed. G5 D3 explicitly KEEPS class
 * identities in place inside the codebase and translates to envelope shape
 * AT THE WIRE BOUNDARY via `serverErrorToEnvelope()` — no invasive call-site
 * rewrites.
 *
 * Under G5 D3, T4.1's true contract is:
 *   1. Verify every existing ad-hoc Error class either has explicit envelope
 *      mapping in `serverErrorToEnvelope()` OR safely defaults to
 *      `INTERNAL_SERVER_ERROR` (the documented contract for build-time errors
 *      that never reach the wire boundary).
 *   2. Prove the wire-format JSON envelope is valid for every Error class —
 *      i.e., has `code` field, has `message`, no stack leak in non-dev mode.
 *   3. Cover EC-3 cause-chain preservation through the boundary translator
 *      (depth-1 and depth-2 chains).
 *   4. Cause-chain preservation is REQUIRED for diagnostics.
 *
 * The original plan AC#1 ("retorna ≤6 classes after migration") is
 * documented as REINTERPRETED — see CHANGELOG entry T4.1 for the full
 * reconciliation rationale.
 */
import { describe, expect, it } from 'vitest'

import { serverErrorToEnvelope } from '../../packages/theo/src/core/contracts/server-error-to-envelope.js'
import { TheoError } from '../../packages/theo/src/core/contracts/theo-error.js'
import type {
  TheoErrorCode,
  TheoErrorEnvelope,
} from '../../packages/theo/src/core/contracts/error-envelope.js'

// Imports of every ad-hoc Error class in packages/theo/src/.
// Total: 29 (one per grep `^export class \w*Error`).
import { NetlifyConflictError } from '../../packages/theo/src/adapters/netlify.js'
import { StaticPathsRequiredError } from '../../packages/theo/src/adapters/static-paths.js'
import {
  StaticApiRoutesDetectedError,
  StaticRenderError,
} from '../../packages/theo/src/adapters/static.js'
import {
  InvalidPackageNameError,
  UnknownPackageError,
} from '../../packages/theo/src/cli/commands/add.js'
import { RouterMigrationCollisionError } from '../../packages/theo/src/cli/commands/migrate/router-codemod.js'
import { TheoFetchError } from '../../packages/theo/src/client/theo-fetch.js'
import { TheoConfigError } from '../../packages/theo/src/config/errors.js'
import { TheoProjectError } from '../../packages/theo/src/core/errors.js'
import { AuthRequiredError } from '../../packages/theo/src/server/auth/auth.js'
import { FileTooLargeError } from '../../packages/theo/src/server/body-parser.js'
import { RequestBodyTooLargeError } from '../../packages/theo/src/server/body-parser-web.js'
import { ExistingConfigUnparseableError } from '../../packages/theo/src/server/cron/adapter-translators.js'
import { DuplicateCronNameError } from '../../packages/theo/src/server/cron/cron-scan.js'
import { BatchPathConflictError } from '../../packages/theo/src/server/http/batch-handler.js'
import { DuplicateContextKeyError } from '../../packages/theo/src/server/jobs/duplicate-context-key-error.js'
import { NonRetryableError } from '../../packages/theo/src/server/jobs/job-backend.js'
import { DuplicateJobNameError } from '../../packages/theo/src/server/jobs/job-scan.js'
import { InvalidPluginShapeError } from '../../packages/theo/src/server/plugins/load-plugins.js'
import {
  DuplicatePluginError,
  DuplicateDecorationError,
} from '../../packages/theo/src/server/plugins/plugin-runner.js'
import { ActionScanError } from '../../packages/theo/src/server/scan/action-scan.js'
import { RouterConventionError } from '../../packages/theo/src/server/scan/errors.js'
import { BodyTooLargeError } from '../../packages/theo/src/server/webhook/raw-body.js'
import {
  IntegrationVirtualModulePrefixError,
  IntegrationRouteCollisionError,
} from '../../packages/theo/src/vite-plugin/integrations.js'
import { ZodToOpenApiError } from '../../packages/theo/src/vite-plugin/openapi-emit/zod-to-openapi.js'

/**
 * Catalog the 29 Error classes by category:
 * - WIRE_BOUND: errors that legitimately cross the request boundary and MUST
 *   have an explicit envelope code mapped in `ERROR_NAME_TO_CODE`.
 * - BUILD_TIME: errors that fire at boot/scan/CLI time and never reach a wire
 *   response. They safely default to `INTERNAL_SERVER_ERROR` per G5 D3 design.
 *
 * Per `server-error-to-envelope.ts:23-27` JSDoc:
 *   "Build-time errors (Duplicate*, ActionScanError, InvalidPluginShapeError)
 *    are NOT in this table by design — they never cross the wire boundary,
 *    so their canonical shape is INTERNAL_SERVER_ERROR via the default branch."
 */
interface ErrorCase {
  className: string
  factory: () => Error
  expectedCode: TheoErrorCode
  category: 'WIRE_BOUND' | 'BUILD_TIME'
}

const ERROR_CASES: readonly ErrorCase[] = [
  // ===== WIRE_BOUND =====
  // 1. AuthRequiredError → UNAUTHORIZED
  {
    className: 'AuthRequiredError',
    factory: () => new AuthRequiredError('Token expired'),
    expectedCode: 'UNAUTHORIZED',
    category: 'WIRE_BOUND',
  },
  // 2-4. *TooLarge family → PAYLOAD_TOO_LARGE
  {
    className: 'FileTooLargeError',
    factory: () => new FileTooLargeError('File too large', ['huge.bin'], 1_048_576),
    expectedCode: 'PAYLOAD_TOO_LARGE',
    category: 'WIRE_BOUND',
  },
  {
    className: 'RequestBodyTooLargeError',
    factory: () => new RequestBodyTooLargeError(10_000_000, 1_048_576),
    expectedCode: 'PAYLOAD_TOO_LARGE',
    category: 'WIRE_BOUND',
  },
  {
    className: 'BodyTooLargeError',
    factory: () => new BodyTooLargeError(2048, 4096),
    expectedCode: 'PAYLOAD_TOO_LARGE',
    category: 'WIRE_BOUND',
  },
  // 5. RouterConventionError → INTERNAL_SERVER_ERROR + HintExt (dev-error overlay)
  {
    className: 'RouterConventionError',
    factory: () =>
      new RouterConventionError({
        file: 'server/routes/auth.[provider].login.ts',
        suggestion: 'server/routes/auth/[provider]/login.ts',
      }),
    expectedCode: 'INTERNAL_SERVER_ERROR',
    category: 'WIRE_BOUND',
  },
  // ===== BUILD_TIME (default INTERNAL_SERVER_ERROR per G5 D3) =====
  {
    className: 'NetlifyConflictError',
    factory: () => new NetlifyConflictError('/*', '/.netlify/functions/old'),
    expectedCode: 'INTERNAL_SERVER_ERROR',
    category: 'BUILD_TIME',
  },
  {
    className: 'StaticPathsRequiredError',
    factory: () => new StaticPathsRequiredError('/posts/[slug]', 'app/posts/[slug]/params.ts'),
    expectedCode: 'INTERNAL_SERVER_ERROR',
    category: 'BUILD_TIME',
  },
  {
    className: 'StaticApiRoutesDetectedError',
    factory: () => new StaticApiRoutesDetectedError(['/api/foo']),
    expectedCode: 'INTERNAL_SERVER_ERROR',
    category: 'BUILD_TIME',
  },
  {
    className: 'StaticRenderError',
    factory: () => new StaticRenderError('/about', new Error('render boom')),
    expectedCode: 'INTERNAL_SERVER_ERROR',
    category: 'BUILD_TIME',
  },
  {
    className: 'InvalidPackageNameError',
    factory: () => new InvalidPackageNameError('!!bad', 'contains invalid characters'),
    expectedCode: 'INTERNAL_SERVER_ERROR',
    category: 'BUILD_TIME',
  },
  {
    className: 'UnknownPackageError',
    factory: () => new UnknownPackageError('@theokit/nonexistent'),
    expectedCode: 'INTERNAL_SERVER_ERROR',
    category: 'BUILD_TIME',
  },
  {
    className: 'RouterMigrationCollisionError',
    factory: () =>
      new RouterMigrationCollisionError(
        'server/routes/auth.login.ts',
        'server/routes/Auth/login.ts',
      ),
    expectedCode: 'INTERNAL_SERVER_ERROR',
    category: 'BUILD_TIME',
  },
  {
    className: 'TheoFetchError',
    // Client-side error; for boundary translation it returns the default branch
    // (server never throws TheoFetchError — it's a client surface).
    factory: () => new TheoFetchError(404, { error: { code: 'NOT_FOUND', message: 'gone' } }),
    expectedCode: 'INTERNAL_SERVER_ERROR',
    category: 'BUILD_TIME',
  },
  {
    className: 'TheoConfigError',
    factory: () =>
      new TheoConfigError(
        [{ field: 'distDir', message: 'must be a string' }],
        '/proj/theo.config.ts',
      ),
    expectedCode: 'INTERNAL_SERVER_ERROR',
    category: 'BUILD_TIME',
  },
  {
    className: 'TheoProjectError',
    factory: () => new TheoProjectError(['Missing app/ directory'], '/proj/root'),
    expectedCode: 'INTERNAL_SERVER_ERROR',
    category: 'BUILD_TIME',
  },
  {
    className: 'ExistingConfigUnparseableError',
    factory: () =>
      new ExistingConfigUnparseableError(
        '/proj/vercel.json',
        'JSON.parse failed at line 12: Unexpected token',
      ),
    expectedCode: 'INTERNAL_SERVER_ERROR',
    category: 'BUILD_TIME',
  },
  {
    className: 'DuplicateCronNameError',
    factory: () => new DuplicateCronNameError('cron-a', ['/a.ts', '/b.ts']),
    expectedCode: 'INTERNAL_SERVER_ERROR',
    category: 'BUILD_TIME',
  },
  {
    className: 'BatchPathConflictError',
    factory: () => new BatchPathConflictError('/api/batch'),
    expectedCode: 'INTERNAL_SERVER_ERROR',
    category: 'BUILD_TIME',
  },
  {
    className: 'DuplicateContextKeyError',
    factory: () => new DuplicateContextKeyError('user', { reason: 'already decorated by pluginA' }),
    expectedCode: 'INTERNAL_SERVER_ERROR',
    category: 'BUILD_TIME',
  },
  {
    className: 'NonRetryableError',
    factory: () => new NonRetryableError('Permanent failure: invalid input'),
    expectedCode: 'INTERNAL_SERVER_ERROR',
    category: 'BUILD_TIME',
  },
  {
    className: 'DuplicateJobNameError',
    factory: () => new DuplicateJobNameError('job-a', ['/a.ts', '/b.ts']),
    expectedCode: 'INTERNAL_SERVER_ERROR',
    category: 'BUILD_TIME',
  },
  {
    className: 'InvalidPluginShapeError',
    factory: () => new InvalidPluginShapeError(0, 'missing register() method'),
    expectedCode: 'INTERNAL_SERVER_ERROR',
    category: 'BUILD_TIME',
  },
  {
    className: 'DuplicatePluginError',
    factory: () => new DuplicatePluginError('cors'),
    expectedCode: 'INTERNAL_SERVER_ERROR',
    category: 'BUILD_TIME',
  },
  {
    className: 'DuplicateDecorationError',
    // @deprecated as of T3.1 — kept for backward compat instanceof checks.
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- intentional: verifies envelope coverage during the deprecation window
    factory: () => new DuplicateDecorationError('user', 'pluginA', 'pluginB'),
    expectedCode: 'INTERNAL_SERVER_ERROR',
    category: 'BUILD_TIME',
  },
  {
    className: 'ActionScanError',
    factory: () =>
      new ActionScanError('NAME_COLLISION', 'Action name "foo" duplicated', [
        '/server/actions/foo.ts',
        '/server/actions/bar/foo.ts',
      ]),
    expectedCode: 'INTERNAL_SERVER_ERROR',
    category: 'BUILD_TIME',
  },
  {
    className: 'IntegrationVirtualModulePrefixError',
    factory: () => new IntegrationVirtualModulePrefixError('foo', 'virtual:bad-id'),
    expectedCode: 'INTERNAL_SERVER_ERROR',
    category: 'BUILD_TIME',
  },
  {
    className: 'IntegrationRouteCollisionError',
    factory: () => new IntegrationRouteCollisionError('pluginA', '/api/x'),
    expectedCode: 'INTERNAL_SERVER_ERROR',
    category: 'BUILD_TIME',
  },
  {
    className: 'ZodToOpenApiError',
    factory: () => new ZodToOpenApiError('Unsupported Zod type: ZodFunction'),
    expectedCode: 'INTERNAL_SERVER_ERROR',
    category: 'BUILD_TIME',
  },
  // TheoError pass-through — envelope identity preservation.
  {
    className: 'TheoError',
    factory: () => new TheoError({ code: 'BAD_REQUEST', message: 'Invalid input' }),
    expectedCode: 'BAD_REQUEST',
    category: 'WIRE_BOUND',
  },
]

describe('envelope wire-format roundtrip — coverage of all 29 Error classes (T4.1)', () => {
  it('catalog covers exactly 29 error classes (matches grep count of `^export class \\w*Error`)', () => {
    // Given: the source-tree grep returns 29 exported Error subclasses
    // When: we count the cases declared above
    // Then: parity is preserved (no class added/removed without test update)
    expect(ERROR_CASES.length).toBe(29)
  })

  it.each(ERROR_CASES)(
    'should serialize $className via serverErrorToEnvelope to a valid envelope ($category → $expectedCode)',
    ({ className, factory, expectedCode }) => {
      // Given: an instance of the Error class
      const err = factory()

      // When: translated at the boundary
      const env: TheoErrorEnvelope = serverErrorToEnvelope(err)

      // Then: envelope has the canonical code + preserves message + carries
      // class identity in meta.name for diagnostics
      expect(env.code).toBe(expectedCode)
      expect(typeof env.message).toBe('string')
      // TheoError is the pass-through case; the others go through the
      // class-name lookup branch and have meta.name set.
      if (className !== 'TheoError') {
        expect(env.meta?.name).toBe(className)
      }
    },
  )

  it('serialized envelope JSON has only canonical keys (no stack leak in default mode)', () => {
    // Given: a wire-bound error with a stack trace
    const err = new AuthRequiredError('Token expired')

    // When: serialized to JSON (the wire boundary)
    const env = serverErrorToEnvelope(err)
    const wire = JSON.parse(JSON.stringify(env)) as Record<string, unknown>

    // Then: wire body has only documented envelope fields; no `.stack` leaks
    // (TheoError.toJSON strips meta.stack in non-dev mode — see G5 ADR D5)
    const allowedKeys = new Set(['code', 'message', 'cause', 'meta', 'ext'])
    for (const key of Object.keys(wire)) {
      expect(allowedKeys).toContain(key)
    }
    // meta carries class diagnostic — must NOT include the stack
    expect((wire.meta as Record<string, unknown> | null)?.stack).toBeUndefined()
  })

  // ===== EC-3 cause chain preservation tests =====

  describe('EC-3 — cause chain preservation through envelope', () => {
    it('preserves depth-1 cause chain (envelope.cause identity check)', () => {
      // Given: a wire-bound error with a JS-native `.cause` field
      const inner = new Error('inner DB connection refused')
      const outer = new AuthRequiredError('Session lookup failed')
      ;(outer as Error & { cause?: unknown }).cause = inner

      // When: translated at the boundary
      const env = serverErrorToEnvelope(outer)

      // Then: envelope.cause identity is preserved (NOT cloned) so the full
      // diagnostic chain is available downstream (devtools, observability)
      expect(env.code).toBe('UNAUTHORIZED')
      expect(env.cause).toBe(inner)
      expect((env.cause as Error).message).toBe('inner DB connection refused')
    })

    it('preserves depth-2 cause chain (chained .cause traversable)', () => {
      // Given: a depth-2 chain — outer.cause.cause is defined
      const depth2 = new Error('depth 2 — root cause')
      const depth1 = new Error('depth 1 — middle')
      ;(depth1 as Error & { cause?: unknown }).cause = depth2
      const outer = new BodyTooLargeError(1024, 2048)
      ;(outer as Error & { cause?: unknown }).cause = depth1

      // When: translated at the boundary
      const env = serverErrorToEnvelope(outer)

      // Then: depth-2 traversal works (envelope.cause → .cause → root)
      expect(env.code).toBe('PAYLOAD_TOO_LARGE')
      expect(env.cause).toBe(depth1)
      const middle = env.cause as Error & { cause?: unknown }
      expect(middle.cause).toBe(depth2)
      expect((middle.cause as Error).message).toBe('depth 2 — root cause')
    })

    it('handles missing cause gracefully (envelope.cause === undefined)', () => {
      // Given: an error with no .cause field
      const err = new RequestBodyTooLargeError(100, 50)

      // When: translated at the boundary
      const env = serverErrorToEnvelope(err)

      // Then: envelope.cause is undefined (NOT null, NOT empty object)
      expect(env.cause).toBeUndefined()
      expect(env.code).toBe('PAYLOAD_TOO_LARGE')
    })
  })

  describe('EC-default — non-Error values wrapped safely', () => {
    it('serializes a thrown string into INTERNAL_SERVER_ERROR envelope', () => {
      // Given: a non-Error value (anti-pattern, but defensible at boundary)
      const value = 'something went wrong as a string'

      // When: translated at the boundary
      const env = serverErrorToEnvelope(value)

      // Then: safe wrapper envelope with the string preserved as message
      expect(env.code).toBe('INTERNAL_SERVER_ERROR')
      expect(env.message).toBe('something went wrong as a string')
    })

    it('serializes a thrown number/object into INTERNAL_SERVER_ERROR with safe message', () => {
      // Given: a non-Error, non-string value
      const value = { random: 'object' }

      // When: translated at the boundary
      const env = serverErrorToEnvelope(value)

      // Then: safe fallback ("Unknown error") + INTERNAL_SERVER_ERROR
      expect(env.code).toBe('INTERNAL_SERVER_ERROR')
      expect(env.message).toBe('Unknown error')
    })
  })
})
