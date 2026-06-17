/**
 * In-house `emitOpenApi()` orchestrator (build-time only).
 *
 * Pure transformation: takes a route manifest (already hydrated with Zod
 * schemas extracted from `defineRoute()` config) + the openapi config
 * block, builds an OpenAPI 3.x document, writes `<outDir>/openapi.json`,
 * returns the document for downstream callers (CLI logs, tests).
 *
 * Per G2 plan v1.1 T2.1. Modelled on trpc-openapi's
 * `generateOpenApiDocument` + encore's `Generator.Generate()`.
 *
 * NEVER ship to runtime — devDep-shaped artifact.
 *
 * Path templating: TheoKit's `:param` syntax is converted to OpenAPI's
 * `{param}` per the spec. Env-var override: `THEOKIT_OPENAPI_SERVER_URL`
 * overrides `servers[0].url` without rebuilding the config.
 */
/* eslint-disable security/detect-non-literal-fs-filename --
 * Build-time emit. outDir is a config-controlled relative path. The
 * caller already refused absolute paths via theoConfigSchema.distDir
 * pattern; the openapi.outDir field follows the same convention.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { z } from 'zod'

import { zodToOpenApiSchema, type ConvertCtx, type OpenApiSchema } from './zod-to-openapi.js'

export interface OpenApiManifestRoute {
  /** TheoKit-style path with `:param` placeholders (`/users/:id`). */
  routePath: string
  /** Uppercase HTTP methods the route exports (`['GET','POST']`). */
  methods: string[]
  /** Optional `defineRoute({body})` schema. */
  body?: z.ZodType
  /** Optional `defineRoute({query})` schema. */
  query?: z.ZodType
  /** Optional `defineRoute({params})` schema. */
  params?: z.ZodType
  /** Optional `defineRoute({response})` schema. */
  response?: z.ZodType
}

export interface OpenApiEmitConfig {
  servers: { url: string; description?: string }[]
  specVersion: '3.1.0' | '3.0.3'
  title: string
  version: string
  outDir: string
}

export interface OpenApiOperation {
  operationId?: string
  parameters?: OpenApiParameter[]
  requestBody?: {
    required?: boolean
    content: Record<string, { schema: OpenApiSchema }>
  }
  responses: Record<
    string,
    { description: string; content?: Record<string, { schema: OpenApiSchema }> }
  >
}

export interface OpenApiParameter {
  name: string
  in: 'path' | 'query' | 'header' | 'cookie'
  required: boolean
  schema: OpenApiSchema
  description?: string
}

export type OpenApiPathItem = Partial<
  Record<'get' | 'post' | 'put' | 'patch' | 'delete' | 'head' | 'options', OpenApiOperation>
>

export interface OpenApiDocument {
  openapi: '3.1.0' | '3.0.3'
  info: { title: string; version: string }
  servers: { url: string; description?: string }[]
  paths: Record<string, OpenApiPathItem>
  components?: { schemas?: Record<string, OpenApiSchema> }
}

export interface EmitOpenApiInput {
  manifest: OpenApiManifestRoute[]
  config: OpenApiEmitConfig
}

export interface EmitOpenApiResult {
  document: OpenApiDocument
  path: string
}

const METHOD_TO_KEY: Record<string, keyof OpenApiPathItem> = {
  GET: 'get',
  POST: 'post',
  PUT: 'put',
  PATCH: 'patch',
  DELETE: 'delete',
  HEAD: 'head',
  OPTIONS: 'options',
}

/** Convert `/users/:id/posts/:postId?` → `/users/{id}/posts/{postId}`. */
export function templatePath(routePath: string): string {
  // Bounded quantifier (\w{0,64}) is OSS-safe — TheoKit route param names
  // never exceed 64 chars in practice; cap prevents super-linear backtracking.
  return routePath.replace(/:([A-Za-z_]\w{0,64})\??/g, '{$1}')
}

function buildParameters(
  paramsSchema: z.ZodType | undefined,
  querySchema: z.ZodType | undefined,
  ctx: ConvertCtx,
): OpenApiParameter[] {
  const out: OpenApiParameter[] = []
  if (paramsSchema !== undefined) {
    appendObjectAsParameters(paramsSchema, 'path', out, ctx)
  }
  if (querySchema !== undefined) {
    appendObjectAsParameters(querySchema, 'query', out, ctx)
  }
  return out
}

function appendObjectAsParameters(
  schema: z.ZodType,
  location: 'path' | 'query',
  out: OpenApiParameter[],
  ctx: ConvertCtx,
): void {
  // We expect an object schema; if it's not, skip silently (caller already
  // validated upstream when scanning defineRoute()).
  const shape = (schema as unknown as { shape?: Record<string, z.ZodType> }).shape
  if (shape === undefined) return
  for (const [name, child] of Object.entries(shape)) {
    // A field is optional iff the schema accepts `undefined` (covers
    // `.optional()` + `.default()`). Runtime check via safeParse — robust
    // across zod versions, unlike reading the changed `_def.typeName` internal
    // (zod 3) / `def.type` (zod 4).
    const optional = child.safeParse(undefined).success
    out.push({
      name,
      in: location,
      required: location === 'path' ? true : !optional,
      schema: zodToOpenApiSchema(child, { ctx }),
    })
  }
}

function buildOperation(
  route: OpenApiManifestRoute,
  ctx: ConvertCtx,
  method: string,
): OpenApiOperation {
  // Bounded sanitizer: two single-pass replacements (no nested quantifiers).
  const sanitized = route.routePath.replace(/[/:\-{}]/g, '_').replace(/_+/g, '_')
  const operationId = `${method.toLowerCase()}_${sanitized.replace(/^_|_$/g, '')}`
  const op: OpenApiOperation = {
    operationId,
    responses: {
      '200': { description: 'OK' },
    },
  }

  const parameters = buildParameters(route.params, route.query, ctx)
  if (parameters.length > 0) op.parameters = parameters

  // Body only meaningful for write methods; we still attach if defined so
  // the document is honest about the contract.
  if (route.body !== undefined) {
    op.requestBody = {
      required: true,
      content: {
        'application/json': { schema: zodToOpenApiSchema(route.body, { ctx }) },
      },
    }
  }

  if (route.response !== undefined) {
    op.responses['200'] = {
      description: 'OK',
      content: {
        'application/json': { schema: zodToOpenApiSchema(route.response, { ctx }) },
      },
    }
  }

  return op
}

export function emitOpenApi(input: EmitOpenApiInput): EmitOpenApiResult {
  const { manifest, config } = input

  const ctx: ConvertCtx = { seen: new Map(), components: {} }

  const paths: Record<string, OpenApiPathItem> = {}
  for (const route of manifest) {
    const templatedPath = templatePath(route.routePath)
    const item: OpenApiPathItem = paths[templatedPath] ?? {}
    for (const method of route.methods) {
      // Defensive: manifest emitter normalizes to uppercase, but if a
      // future scanner produces a non-HTTP verb the key lookup yields
      // undefined and we skip silently. TS narrows the indexed type to
      // keyof OpenApiPathItem; the runtime undefined check is honest.
      const key = METHOD_TO_KEY[method.toUpperCase()] as keyof OpenApiPathItem | undefined
      if (key === undefined) continue
      item[key] = buildOperation(route, ctx, method)
    }
    paths[templatedPath] = item
  }

  const servers = applyServerOverride(config.servers)

  const document: OpenApiDocument = {
    openapi: config.specVersion,
    info: { title: config.title, version: config.version },
    servers,
    paths,
  }

  if (Object.keys(ctx.components).length > 0) {
    document.components = { schemas: ctx.components }
  }

  mkdirSync(config.outDir, { recursive: true })
  const outPath = join(config.outDir, 'openapi.json')
  writeFileSync(outPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8')

  return { document, path: outPath }
}

function applyServerOverride(
  servers: { url: string; description?: string }[],
): { url: string; description?: string }[] {
  const override = process.env.THEOKIT_OPENAPI_SERVER_URL
  if (override === undefined || override === '') return servers
  if (servers.length === 0) return [{ url: override }]
  const [first, ...rest] = servers
  return [
    {
      url: override,
      ...(first.description !== undefined ? { description: first.description } : {}),
    },
    ...rest,
  ]
}
