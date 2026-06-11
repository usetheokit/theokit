/**
 * Comprehensive synthetic "app" for golden-fixture test.
 *
 * Covers: GET (no body), POST (body), PUT with params + body, DELETE with
 * params, GET with query (optional + required), and a route with response
 * schema. Five representative routes.
 *
 * `source/` files are FIXTURES — never executed at build time, just
 * imported by the golden-fixture test which feeds them through
 * `emitOpenApi()` directly (no Vite loader needed).
 */
import { z } from 'zod'

import type { OpenApiManifestRoute } from '../../../../packages/theo/src/vite-plugin/openapi-emit/emit.js'

export const FULL_APP_MANIFEST: OpenApiManifestRoute[] = [
  { routePath: '/health', methods: ['GET'] },
  {
    routePath: '/users',
    methods: ['POST'],
    body: z.object({
      name: z.string(),
      email: z.string().email(),
      role: z.enum(['admin', 'user']),
    }),
  },
  {
    routePath: '/users/:id',
    methods: ['PUT'],
    params: z.object({ id: z.string().uuid() }),
    body: z.object({ name: z.string().optional(), role: z.enum(['admin', 'user']).optional() }),
  },
  {
    routePath: '/users/:id',
    methods: ['DELETE'],
    params: z.object({ id: z.string().uuid() }),
  },
  {
    routePath: '/posts',
    methods: ['GET'],
    query: z.object({
      page: z.number().int().optional(),
      limit: z.number().int().optional(),
      author: z.string(),
    }),
    response: z.object({
      total: z.number().int(),
      items: z.array(z.object({ id: z.string(), title: z.string() })),
    }),
  },
]
