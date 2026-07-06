// examples/code-assistant — the SAME read-only assistant, in the M8 fluent-builder form.
//
// This is the canonical M8 surface: `agent()` accumulates type-state and resolves to the same
// branded AgentDefinition `defineAgent` produces (one runtime, N syntaxes). The point it makes
// over `assistant.ts`: `projectRoot` is set ONCE with `.context({ projectRoot })` (M7 run-context)
// instead of threaded into every tool factory — the tools read it from `ctx.context` at run time.
//
// Ships with the M7 + M8 release (`@theokit/agents` run-context seam + builder). Dropping this at
// agents/assistant-builder.ts auto-serves `POST /api/agents/assistant-builder`.
import { agent, contextualTool } from '@theokit/agents'
import { defineAgentTool } from 'theokit/server'
import { z } from 'zod'

// The run-context shape every tool in this agent can rely on. Declared once, at the agent level.
interface AssistantContext {
  projectRoot: string
}

// A tool that reads `projectRoot` from the run-context (ctx.context), NOT from a factory argument.
// `contextualTool(tool, witness)` tags it with a literal name (accumulated into the builder's
// tool-name union) and the context it requires — `.tool()` is a COMPILE ERROR if the agent's
// `.context()` does not satisfy `AssistantContext`.
const countLinesTool = contextualTool(
  defineAgentTool({
    name: 'count_lines',
    description: 'Count the non-blank lines in a file relative to the project root.',
    inputSchema: z.object({ path: z.string() }),
    handler: async ({ path }, ctx) => {
      const { projectRoot } = ctx?.context as AssistantContext
      const { readFile } = await import('node:fs/promises')
      const { resolve } = await import('node:path')
      const text = await readFile(resolve(projectRoot, path), 'utf8')
      return `${path}: ${text.split('\n').filter((l) => l.trim().length > 0).length} non-blank lines`
    },
  }),
  undefined as unknown as AssistantContext,
)

export default agent()
  .model('anthropic/claude-sonnet-4-6') // any OpenRouter model id; provider key from .env
  .system(
    [
      'You are a senior engineer working inside this repository.',
      'Ground every answer in the real code; cite file paths and line numbers.',
      'Never invent a symbol you have not seen.',
    ].join(' '),
  )
  // projectRoot set ONCE, at the agent level — every tool reads it from ctx.context (M7).
  .context({ projectRoot: process.cwd() })
  .tool(countLinesTool)
  .build()
