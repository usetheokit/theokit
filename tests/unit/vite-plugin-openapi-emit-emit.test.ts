/**
 * T2.1 — `emitOpenApi()` orchestrator (build-time only).
 *
 * Pure transformation: takes the route manifest (already loaded with Zod
 * schemas) + the openapi config block, writes `<outDir>/openapi.json`,
 * returns the document for testability.
 *
 * Per G2 plan v1.1 T2.1: 6 RED tests cover write-to-outdir, openapi
 * version field, path templating, servers from config, env-var override,
 * components.schemas from defineRoute body.
 */
import { existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'

import {
  emitOpenApi,
  type OpenApiEmitConfig,
  type OpenApiManifestRoute,
} from '../../packages/theo/src/vite-plugin/openapi-emit/emit.js'

const baseConfig: OpenApiEmitConfig = {
  servers: [{ url: 'http://localhost:3000', description: 'Local development' }],
  specVersion: '3.1.0',
  title: 'TheoKit App',
  version: '0.0.0',
  outDir: '',
}

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'theokit-g2-emit-'))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
  delete process.env.THEOKIT_OPENAPI_SERVER_URL
})

describe('emitOpenApi — file write + header', () => {
  it('writes openapi.json into outDir', () => {
    emitOpenApi({ manifest: [], config: { ...baseConfig, outDir: tmpDir } })
    expect(existsSync(join(tmpDir, 'openapi.json'))).toBe(true)
  })

  it('document.openapi is "3.1.0" by default', () => {
    const { document } = emitOpenApi({
      manifest: [],
      config: { ...baseConfig, outDir: tmpDir },
    })
    expect(document.openapi).toBe('3.1.0')
  })

  it('document.info reflects config.title and config.version', () => {
    const { document } = emitOpenApi({
      manifest: [],
      config: { ...baseConfig, title: 'My App', version: '1.2.3', outDir: tmpDir },
    })
    expect(document.info.title).toBe('My App')
    expect(document.info.version).toBe('1.2.3')
  })
})

describe('emitOpenApi — path templating', () => {
  it('converts :param syntax to {param}', () => {
    const route: OpenApiManifestRoute = { routePath: '/users/:id', methods: ['GET'] }
    const { document } = emitOpenApi({
      manifest: [route],
      config: { ...baseConfig, outDir: tmpDir },
    })
    expect(Object.keys(document.paths)).toContain('/users/{id}')
    expect(Object.keys(document.paths)).not.toContain('/users/:id')
  })

  it('converts nested :params correctly', () => {
    const route: OpenApiManifestRoute = {
      routePath: '/orgs/:org/repos/:repo',
      methods: ['GET'],
    }
    const { document } = emitOpenApi({
      manifest: [route],
      config: { ...baseConfig, outDir: tmpDir },
    })
    expect(Object.keys(document.paths)).toContain('/orgs/{org}/repos/{repo}')
  })
})

describe('emitOpenApi — servers + env override', () => {
  it('document.servers equals config.servers verbatim by default', () => {
    const servers = [
      { url: 'https://api.example.com', description: 'prod' },
      { url: 'https://staging.example.com', description: 'staging' },
    ]
    const { document } = emitOpenApi({
      manifest: [],
      config: { ...baseConfig, servers, outDir: tmpDir },
    })
    expect(document.servers).toEqual(servers)
  })

  it('THEOKIT_OPENAPI_SERVER_URL env var overrides servers[0].url', () => {
    process.env.THEOKIT_OPENAPI_SERVER_URL = 'https://override.example.com'
    const { document } = emitOpenApi({
      manifest: [],
      config: { ...baseConfig, outDir: tmpDir },
    })
    expect(document.servers[0].url).toBe('https://override.example.com')
    // Description preserved from config
    expect(document.servers[0].description).toBe('Local development')
  })
})

describe('emitOpenApi — operations + components', () => {
  it('GET route with no body produces operation with no requestBody', () => {
    const route: OpenApiManifestRoute = { routePath: '/health', methods: ['GET'] }
    const { document } = emitOpenApi({
      manifest: [route],
      config: { ...baseConfig, outDir: tmpDir },
    })
    const op = document.paths['/health']?.get
    expect(op).toBeDefined()
    expect(op?.requestBody).toBeUndefined()
  })

  it('POST route with body Zod schema produces requestBody application/json with schema', () => {
    const route: OpenApiManifestRoute = {
      routePath: '/users',
      methods: ['POST'],
      body: z.object({ name: z.string(), email: z.string().email() }),
    }
    const { document } = emitOpenApi({
      manifest: [route],
      config: { ...baseConfig, outDir: tmpDir },
    })
    const op = document.paths['/users']?.post
    expect(op?.requestBody?.content?.['application/json']?.schema).toBeDefined()
    const schema = op?.requestBody?.content?.['application/json']?.schema as {
      properties?: Record<string, unknown>
    }
    expect(schema?.properties?.name).toEqual({ type: 'string' })
    expect(schema?.properties?.email).toEqual({ type: 'string', format: 'email' })
  })

  it('route with params Zod schema produces parameters[] entries with in:path', () => {
    const route: OpenApiManifestRoute = {
      routePath: '/users/:id',
      methods: ['GET'],
      params: z.object({ id: z.string().uuid() }),
    }
    const { document } = emitOpenApi({
      manifest: [route],
      config: { ...baseConfig, outDir: tmpDir },
    })
    const op = document.paths['/users/{id}']?.get
    expect(op?.parameters).toBeDefined()
    const idParam = op?.parameters?.find((p) => p.name === 'id')
    expect(idParam).toBeDefined()
    expect(idParam?.in).toBe('path')
    expect(idParam?.required).toBe(true)
  })

  it('route with query Zod schema produces parameters[] entries with in:query', () => {
    const route: OpenApiManifestRoute = {
      routePath: '/users',
      methods: ['GET'],
      query: z.object({ page: z.number().int().optional(), limit: z.number().int().optional() }),
    }
    const { document } = emitOpenApi({
      manifest: [route],
      config: { ...baseConfig, outDir: tmpDir },
    })
    const op = document.paths['/users']?.get
    const pageParam = op?.parameters?.find((p) => p.name === 'page')
    expect(pageParam?.in).toBe('query')
    expect(pageParam?.required).toBe(false)
  })
})

describe('emitOpenApi — file content is valid JSON', () => {
  it('written file parses as JSON and matches returned document', () => {
    const { document } = emitOpenApi({
      manifest: [{ routePath: '/ping', methods: ['GET'] }],
      config: { ...baseConfig, outDir: tmpDir },
    })
    const raw = readFileSync(join(tmpDir, 'openapi.json'), 'utf8')
    const parsed = JSON.parse(raw) as unknown
    expect(parsed).toEqual(document)
  })

  it('emits trailing newline (POSIX convention)', () => {
    emitOpenApi({ manifest: [], config: { ...baseConfig, outDir: tmpDir } })
    const raw = readFileSync(join(tmpDir, 'openapi.json'), 'utf8')
    expect(raw.endsWith('\n')).toBe(true)
  })
})
