/* eslint-disable security/detect-non-literal-fs-filename --
 * AWS Lambda adapter. Writes to `cwd/.theokit/lambda/`. Build-time tool.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import type { TheoConfig } from '../config/schema.js'
import type { SecurityHeadersConfig } from '../core/contracts/security-headers.js'
import { assertServicesUnsupported, readManifest } from '../services/index.js'

import { deployedCorsFragment, type DeployedCorsOptions } from './deployed-cors.js'
import { deployedCsrfFragment, type DeployedCsrfOptions } from './deployed-csrf.js'
import {
  deployedRuntimeConfigFragment,
  type DeployedRuntimeConfigOptions,
} from './deployed-runtime-config.js'
import { deployedTraceFragment } from './deployed-trace.js'
import { nodeAdapter } from './node.js'
import {
  describeDeployedSecurityHeaders,
  renderSecurityHeadersConfigLiteral,
} from './security-headers.js'
import type { AdapterBuildContext, DeployAdapter } from './types.js'

export interface AwsLambdaBuildDeps {
  runNodeBuild?: (config: TheoConfig, cwd: string, ctx?: AdapterBuildContext) => Promise<void>
  writeEntry?: (path: string, content: string) => void
  ensureDir?: (path: string) => void
}

export interface RequestShape {
  method: string
  path: string
  headers: Record<string, string>
  body?: string
}

export interface LambdaResultV2 {
  statusCode: number
  headers: Record<string, string>
  body: string
  isBase64Encoded: boolean
}

const BINARY_CONTENT_TYPES = [
  'application/octet-stream',
  'application/pdf',
  'application/zip',
  'image/',
  'audio/',
  'video/',
]

function isBinaryContentType(contentType: string | undefined): boolean {
  if (!contentType) return false
  const ct = contentType.toLowerCase()
  return BINARY_CONTENT_TYPES.some((prefix) => ct.startsWith(prefix))
}

interface APIGatewayProxyEventV2 {
  version: string
  requestContext: {
    http: { method: string; path: string }
  }
  headers?: Record<string, string | undefined>
  body?: string
  isBase64Encoded?: boolean
}

export function eventV2ToRequestShape(event: APIGatewayProxyEventV2): RequestShape {
  const headers: Record<string, string> = {}
  for (const [k, v] of Object.entries(event.headers ?? {})) {
    if (v !== undefined) headers[k] = v
  }
  let body: string | undefined = event.body
  if (body !== undefined && event.isBase64Encoded) {
    body = Buffer.from(body, 'base64').toString('utf-8')
  }
  return {
    method: event.requestContext.http.method,
    path: event.requestContext.http.path,
    headers,
    body,
  }
}

export function responseToLambdaResultV2(
  statusCode: number,
  headers: Record<string, string>,
  body: string,
): LambdaResultV2 {
  const isBinary = isBinaryContentType(headers['content-type'])
  return {
    statusCode,
    headers,
    body: isBinary ? Buffer.from(body, 'binary').toString('base64') : body,
    isBase64Encoded: isBinary,
  }
}

// Generated-code fragments — extracted so the parent emitter stays under the
// max-lines-per-function ceiling.
/** The v2 result conversion, the handler, and the routing that feeds them. */
function awsLambdaHandlerFragment(runtimeSpread: string): string[] {
  return [
    `// #382 — this target is DELISTED for response streaming, by construction.`,
    `// The Lambda v2 result object below carries \`body\` as a string, so the`,
    `// response cannot exist until the run has finished, no matter how the`,
    `// framework's shim writes it. Streaming here would require`,
    `// \`awslambda.streamifyResponse\` plus a Function URL in RESPONSE_STREAM`,
    `// invoke mode — neither of which this adapter emits, and which would break`,
    `// every API Gateway deployment of it. Rather than degrade in silence, a`,
    `// response that is unambiguously a stream is named in the logs below.`,
    `async function responseToV2Result(response, routePath) {`,
    `  const headers = {}`,
    `  response.headers.forEach((v, k) => { headers[k] = v })`,
    `  const ct = headers['content-type'] ?? ''`,
    `  if (ct.includes('text/event-stream')) {`,
    `    console.warn(`,
    `      '[theo][aws-lambda] ' + routePath + ' returned a streaming response (' + ct + '), ' +`,
    `      'but the aws-lambda target buffers it whole and delivers it when the run ends. ' +`,
    `      'This target is delisted for streaming (theokit#382). Deploy streaming routes to ' +`,
    `      'cloudflare, vercel, netlify, bun, deno-deploy or node.'`,
    `    )`,
    `  }`,
    `  const isBinary = /^application\\/(octet-stream|pdf|zip)|^(image|audio|video)\\//.test(ct)`,
    `  if (isBinary) {`,
    `    const buf = Buffer.from(await response.arrayBuffer())`,
    `    return {`,
    `      statusCode: response.status,`,
    `      headers,`,
    `      body: buf.toString('base64'),`,
    `      isBase64Encoded: true,`,
    `    }`,
    `  }`,
    `  return {`,
    `    statusCode: response.status,`,
    `    headers,`,
    `    body: await response.text(),`,
    `    isBase64Encoded: false,`,
    `  }`,
    `}`,
    ``,
    `// Every outcome — including both 404s — is produced as a Web Response by`,
    `// routeRequest, so the security baseline is applied at ONE place and the`,
    `// v2 result object is built from headers that already carry it.`,
    `export const handler = async (event) => {`,
    `  const path = event.requestContext?.http?.path ?? '/'`,
    `  // #409 — the same event, read as a Web Request so the CORS matcher can see the method and`,
    `  // the \`origin\` header. \`eventV2ToRequest\` reads a body already present in the event, so`,
    `  // unlike the Node targets there is no stream to drain twice.`,
    `  const corsRequest = eventV2ToRequest(event)`,
    ``,
    `  // The preflight is answered BEFORE anything routes: an OPTIONS the router handles is an`,
    `  // OPTIONS the browser never gets a CORS answer to.`,
    `  const preflight = corsPreflight(corsRequest)`,
    `  const response = preflight !== null`,
    `    ? withSecurityHeaders(preflight, SECURITY_HEADERS)`,
    `    : withCors(corsRequest, withSecurityHeaders(await routeRequest(event, path), SECURITY_HEADERS))`,
    `  return responseToV2Result(response, path)`,
    `}`,
    ``,
    `async function routeRequest(event, path) {`,
    `  if (!path.startsWith('/api/')) {`,
    `    return new Response(`,
    `      'Static assets must be served from CloudFront or a separate static host.',`,
    `      { status: 404, headers: { 'content-type': 'text/plain' } },`,
    `    )`,
    `  }`,
    ``,
    `  if (!routesCache) routesCache = scanServerRoutes(serverDir)`,
    `  if (!loaderCache) loaderCache = createProductionLoader()`,
    ``,
    `  const match = matchRoute(path, routesCache)`,
    `  if (!match) {`,
    `    return new Response(JSON.stringify({ error: { code: 'NOT_FOUND' } }), {`,
    `      status: 404,`,
    `      headers: { 'content-type': 'application/json' },`,
    `    })`,
    `  }`,
    ``,
    `  const request = eventV2ToRequest(event)`,
    `  const { req, res, toResponse } = createWebShim(request)`,
    ...deployedTraceFragment('request', '  '),
    `  const method = request.method.toUpperCase()`,
    `  return toResponse(executeRoute({ route: match.route, method, params: match.params, req, res, loadModule: loaderCache, serverDir, requestId, ...CSRF_CONFIG, ${runtimeSpread} }))`,
    `}`,
  ]
}

export function renderAwsLambdaEntry(
  opts: { securityHeaders?: SecurityHeadersConfig } & DeployedCsrfOptions &
    DeployedRuntimeConfigOptions &
    DeployedCorsOptions = {},
): string {
  const runtimeConfig = deployedRuntimeConfigFragment(opts)
  return [
    `// Generated by Theo — AWS Lambda Adapter`,
    `// Use with API Gateway HTTP API v2 (default).`,
    ``,
    `import { resolve } from 'node:path'`,
    `import { scanServerRoutes, matchRoute, executeRoute, createProductionLoader, extractTraceIdFromRequest, TRACE_HEADER, createCorsWebHandler } from 'theokit/server'`,
    `import { createWebShim } from 'theokit/adapters/web-shim'`,
    `import { buildSecurityHeaders, withSecurityHeaders } from 'theokit/adapters/security-headers'`,
    ``,
    `const cwd = process.cwd()`,
    `const serverDir = resolve(cwd, 'server')`,
    `let routesCache = null`,
    `let loaderCache = null`,
    ``,
    `// #410 — the security baseline \`theokit start\` puts on every response,`,
    `// carried here as a literal because the deployed function has no`,
    `// theo.config.ts to read. Non-API paths 404 here and the document is served`,
    `// from CloudFront or another static host, so this covers the API and not the`,
    `// page (usetheokit/theokit#412).`,
    `const SECURITY_HEADERS_CONFIG = ${renderSecurityHeadersConfigLiteral(opts.securityHeaders)}`,
    `const SECURITY_HEADERS = buildSecurityHeaders(SECURITY_HEADERS_CONFIG, { production: true })`,
    ``,
    ...runtimeConfig.imports,
    ...runtimeConfig.declarations,
    ...deployedCsrfFragment(opts),
    ``,
    ...deployedCorsFragment(opts.cors, 'aws-lambda'),
    ``,
    `function eventV2ToRequest(event) {`,
    `  const method = event.requestContext?.http?.method ?? 'GET'`,
    `  const path = event.requestContext?.http?.path ?? '/'`,
    `  const host = event.headers?.host ?? 'lambda'`,
    `  const qs = event.rawQueryString ? '?' + event.rawQueryString : ''`,
    `  const url = 'https://' + host + path + qs`,
    `  const headers = new Headers()`,
    `  for (const [k, v] of Object.entries(event.headers ?? {})) {`,
    `    if (v !== undefined) headers.set(k, String(v))`,
    `  }`,
    `  let body = event.body`,
    `  if (body && event.isBase64Encoded) {`,
    `    body = Buffer.from(body, 'base64')`,
    `  }`,
    `  return new Request(url, {`,
    `    method,`,
    `    headers,`,
    `    body: method === 'GET' || method === 'HEAD' ? undefined : body,`,
    `  })`,
    `}`,
    ``,
    ...awsLambdaHandlerFragment(runtimeConfig.executeRouteSpread),
  ].join('\n')
}

export async function buildAwsLambda(
  config: TheoConfig,
  cwd: string,
  deps: AwsLambdaBuildDeps = {},
  ctx?: AdapterBuildContext,
): Promise<void> {
  // Wave 2 (T2.2) — reject polyglot services on this adapter.
  assertServicesUnsupported('aws-lambda', readManifest(cwd))

  // #382 — refuse by name rather than build something that cannot do what was
  // asked. `ssrStreaming` is the config's declaration that responses stream,
  // and this target is delisted for that (see `awsLambdaAdapter.streamsResponses`).
  if (config.ssrStreaming) {
    throw new Error(
      '[adapter-aws-lambda] ssrStreaming is on, but the aws-lambda target does not stream ' +
        'responses: the Lambda v2 result object carries the body as a string, so nothing can ' +
        'leave the function before the run ends. Response streaming would need ' +
        'awslambda.streamifyResponse plus a Function URL in RESPONSE_STREAM invoke mode, which ' +
        'this adapter does not emit. Build a streaming target instead (cloudflare, vercel, ' +
        'netlify, bun, deno-deploy, node), or set ssrStreaming: false in theo.config.ts.',
    )
  }

  const runNodeBuild = deps.runNodeBuild ?? nodeAdapter.build.bind(nodeAdapter)
  await runNodeBuild(config, cwd, ctx)

  const outputDir = resolve(cwd, '.theokit/aws')
  const ensureDir = deps.ensureDir ?? ((p: string) => mkdirSync(p, { recursive: true }))
  ensureDir(outputDir)

  const entry = renderAwsLambdaEntry({
    securityHeaders: config.security?.headers,
    csrf: config.security?.csrf,
    disallowed: config.security?.disallowed,
    cors: config.security?.cors,
    // #425 — a selector, not a transformer, so it rides as a literal like the values above.
    serialization: config.serialization,
  })
  const write =
    deps.writeEntry ??
    ((p, c) => {
      writeFileSync(p, c)
    })
  write(resolve(outputDir, 'handler.mjs'), entry)

  // eslint-disable-next-line no-console -- CLI build progress
  console.log('\n  ✓ AWS Lambda output → .theokit/aws/handler.mjs')
  // eslint-disable-next-line no-console -- CLI build progress
  console.log(
    `${describeDeployedSecurityHeaders({
      target: 'aws-lambda',
      securityHeaders: config.security?.headers,
      mintsNonce: false,
      documentServedByPlatform: true,
    })}\n`,
  )
}

export const awsLambdaAdapter: DeployAdapter = {
  name: 'aws-lambda',
  // #382 — delisted for streaming, deliberately. See DeployAdapter.
  streamsResponses: false,
  // #409 / #410 — the generated entry calls `executeRoute` with routes, loader
  // and serverDir only. CSRF, route policy, file middleware and Zod validation
  // still run because they live inside `executeRoute`; none of the remaining
  // configurable concerns reach it. Declared explicitly rather than omitted so
  // the gap is a statement in the source and not an absence.
  //
  // `securityHeaders` IS applied -- to every response this function returns.
  // The document comes from CloudFront or another static host and does not pass
  // through it (usetheokit/theokit#412).
  appliesConfig: ['securityHeaders', 'csrf', 'disallowed', 'cors', 'serialization'],
  build(config, cwd, ctx) {
    return buildAwsLambda(config, cwd, {}, ctx)
  },
}
