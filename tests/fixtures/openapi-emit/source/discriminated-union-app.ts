/**
 * Single-feature fixture: discriminated union on the body schema.
 * Mirrors encore's `expected_list_of_union_openapi.json` pattern.
 */
import { z } from 'zod'

import type { OpenApiManifestRoute } from '../../../../packages/theo/src/vite-plugin/openapi-emit/emit.js'

export const DISCRIMINATED_UNION_MANIFEST: OpenApiManifestRoute[] = [
  {
    routePath: '/events',
    methods: ['POST'],
    body: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('click'), x: z.number(), y: z.number() }),
      z.object({ kind: z.literal('keystroke'), key: z.string() }),
    ]),
  },
]
