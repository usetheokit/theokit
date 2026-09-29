/**
 * The AWS Lambda handler must be able to run where it is uploaded.
 *
 * Two independent causes, both measured on 2026-09-29 by BUNDLING the emitted entry, copying the
 * result to a directory with no `node_modules` in any ancestor, importing it and INVOKING it with a
 * synthetic API Gateway v2 event — a Lambda handler is a function, so the whole path is exercisable
 * locally:
 *
 *     the entry as written today, loaded from such a directory
 *       -> ERR_MODULE_NOT_FOUND: Cannot find package 'theokit'
 *          (five bare specifiers: server/scan, server/http, adapters/{agent-mount,security-headers,web-shim})
 *
 *     the same entry, bundled
 *       -> loads, `handler` is callable
 *       -> invoked with GET /api/health: statusCode 404, {"error":{"code":"NOT_FOUND"}}
 *
 * The 404 is the second cause: the entry resolves its routes with a runtime `scanServerRoutes`, which
 * is a `readdirSync` over `serverDir`, and an uploaded function has no source tree. It is the same 404
 * `docs/adr/0020` records for Vercel before B-319 baked its routes, and the same pair B-338 and B-339
 * fixed for Netlify.
 *
 * ## Why this is now a repair rather than a claim
 *
 * `docs/adr/0020` named `netlify` and `aws-lambda` as the two targets it did not change, because
 * "neither has been exercised against its platform and a fix nobody can verify is a claim rather than
 * a repair". Netlify was exercised on its emulator (B-339/B-343). This target needs no emulator: the
 * handler is a plain function, so loading it standalone and calling it IS the exercise — a strictly
 * stronger check than the "the directory loads standalone" property that same ADR accepted as
 * sufficient for Vercel, which it changed without a deployment.
 *
 * What is still NOT established: that AWS itself invokes it. That needs a deployment, and B-263 holds
 * the credential as a retained `access` impediment.
 */
import { describe, expect, it } from 'vitest'

import { renderAwsLambdaEntry } from '../../packages/theo/src/adapters/aws-lambda.js'

import { withoutComments as code } from './_helpers/adapter-source.js'

const ROUTES = [
  { filePath: 'src/server/routes/health.ts', routePath: '/api/health', methods: ['GET'] },
] as const

describe('the Lambda handler is self-contained', () => {
  it('bakes the routes instead of scanning for them at runtime', () => {
    const body = code(renderAwsLambdaEntry({ serverDir: 'src/server', routes: ROUTES }))

    expect(
      body,
      'the entry resolves its routes with a readdirSync over serverDir. An uploaded Lambda has no ' +
        'source tree, so every /api/* answers its own JSON 404 — measured by invoking the bundled ' +
        'handler. And where a tree IS uploaded the files are TypeScript, which a plain Node runtime ' +
        'cannot compile: that is the SyntaxError Netlify answered with before B-338',
    ).not.toContain('scanServerRoutes(')
    expect(body, 'no baked route table was emitted, so nothing replaced the scan').toContain(
      'ROUTE_MODULES',
    )
  })

  it('imports the route modules it bakes', () => {
    // COUNTERPROOF: a table of paths with no imports beside it resolves nothing. This is the pillar
    // that makes the bake real, and it is what `compilePattern` was missing on netlify.
    const body = code(renderAwsLambdaEntry({ serverDir: 'src/server', routes: ROUTES }))

    expect(body).toContain('src/server/routes/health.ts')
    expect(body).toMatch(/import \* as __theoRoute0 from/u)
  })

  it('emits no route table when it is given no routes', () => {
    // The other direction, and it must stay true: a baking target with nothing baked emits no table
    // rather than a fabricated one. `vercel` and `netlify` behave the same way, and the honest
    // outcome is a 404 from the matcher rather than a scan that pretends to have looked.
    const body = code(renderAwsLambdaEntry({ serverDir: 'src/server' }))

    expect(body).not.toContain('scanServerRoutes(')
    expect(body).not.toContain('src/server/routes/health.ts')
  })
})
