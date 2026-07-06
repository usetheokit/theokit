// examples/code-assistant — the read-only code assistant (tutorial: docs/guides/build-a-code-assistant.md)
//
// A senior-engineer agent that grounds every answer in the real repo: it reads files, lists
// directories, greps, and globs — reusing @theokit/sdk-tools instead of hand-rolling a file layer —
// plus one custom tool via defineAgentTool. Dropping this at agents/assistant.ts auto-serves
// `POST /api/agents/assistant` (dev + build), streaming the ai-sdk UIMessageStream that `useAgent`
// consumes. Verified: `tsc --noEmit` = 0 errors + `theokit build` = 0 on the published packages
// (create-theokit@1.0.17 · @theokit/agents@0.30.2 · @theokit/sdk-tools@0.8.0).
import { defineAgent } from '@theokit/agents'
import {
  createReadFileTool,
  createListDirTool,
  createSearchTextTool,
  createGlobTool,
} from '@theokit/sdk-tools'
import { defineAgentTool } from 'theokit/server'
import { z } from 'zod'

const root = process.cwd()

// A custom tool for anything @theokit/sdk-tools doesn't cover. The contract is
// name + description + a Zod inputSchema + a handler that returns a string.
const countLinesTool = defineAgentTool({
  name: 'count_lines',
  description: 'Count the non-blank lines in a file relative to the project root.',
  inputSchema: z.object({ path: z.string() }),
  handler: async ({ path }) => {
    const { readFile } = await import('node:fs/promises')
    const { resolve } = await import('node:path')
    const text = await readFile(resolve(process.cwd(), path), 'utf8')
    return `${path}: ${text.split('\n').filter((l) => l.trim().length > 0).length} non-blank lines`
  },
})

export default defineAgent({
  input: z.object({ message: z.string() }),
  model: 'anthropic/claude-sonnet-4-6', // any OpenRouter model id; provider key from .env
  system: [
    'You are a senior engineer working inside this repository.',
    'Use read_file / list_dir / search_text / glob to ground every answer in the real code.',
    'Cite file paths and line numbers. Never invent a symbol you have not seen.',
  ].join(' '),
  tools: [
    // Ready-made, boundary-checked coding tools — each gates access to `projectRoot`.
    createReadFileTool({ projectRoot: root }),
    createListDirTool({ projectRoot: root }),
    createSearchTextTool({ projectRoot: root, maxMatches: 100 }),
    createGlobTool({ projectRoot: root }),
    countLinesTool,
  ],
})
