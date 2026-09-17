import { ConfigurationError } from '@theokit/agents'
import type { CustomTool } from '@theokit/sdk'

import type { ToolRegistry } from '../tools/registry.js'
import { declareAgent, toolsNamed } from '../composition/agent-spec.js'

/**
 * B-059 — the coding agent's registry-backed tool set, declared through the shared entry.
 *
 * Memoised per registry because the chain asks for one tool at a time and the shape is one
 * decision; rebuilding it per `.tool()` call would make the provenance record say the set was
 * declared six times.
 */
export const READ_TOOLS = [
  'CurrentTime',
  'Read',
  'ViewImage',
  'Glob',
  'Grep',
  'RepoStatus',
  'GitDiff',
] as const
const shapeCache = new WeakMap<ToolRegistry, Map<string, CustomTool>>()

export function readTool(registry: ToolRegistry, name: (typeof READ_TOOLS)[number]): CustomTool {
  let byName = shapeCache.get(registry)
  if (byName === undefined) {
    const shape = declareAgent(
      'coding-agent-reads',
      { registry, model: 'unused', reasoning_effort: 'medium' },
      [toolsNamed(registry, READ_TOOLS)],
    )
    byName = new Map(shape.tools.map((tool: CustomTool) => [tool.name, tool]))
    shapeCache.set(registry, byName)
  }
  const tool = byName.get(name)
  if (tool === undefined) {
    throw new ConfigurationError(`"${name}" is not in the declared coding-agent read set`, {
      code: 'tool_not_declared',
    })
  }
  return tool
}
