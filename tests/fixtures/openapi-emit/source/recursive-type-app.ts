/**
 * Single-feature fixture: z.lazy recursive type with $ref via seen-map.
 * Validates components.schemas + $ref cycle detection (encore schema.go:289
 * pattern translated to TS).
 */
import { z } from 'zod'

import {
  zodToOpenApiSchema,
  type ConvertCtx,
} from '../../../../packages/theo/src/vite-plugin/openapi-emit/zod-to-openapi.js'

interface TreeNode {
  value: string
  next?: TreeNode
}

const TreeSchema: z.ZodType<TreeNode> = z.lazy(() =>
  z.object({ value: z.string(), next: TreeSchema.optional() }),
)

export interface RecursiveFixtureResult {
  ref: { $ref?: string }
  components: Record<string, unknown>
}

/**
 * Recursive fixture doesn't fit the manifest→emit path 1:1 because the
 * recursive `$ref` requires a *named* registration via the optional
 * `name` parameter of `zodToOpenApiSchema`. We exercise it directly + the
 * golden file is the resulting components map.
 */
export function buildRecursiveFixture(): RecursiveFixtureResult {
  const ctx: ConvertCtx = { seen: new Map(), components: {} }
  const ref = zodToOpenApiSchema(TreeSchema, { ctx, name: 'TreeNode' })
  return { ref, components: ctx.components }
}
