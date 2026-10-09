import { describe, it, expect } from 'vitest'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { generate } from '../../packages/theo/src/cli/commands/generate.js'

/**
 * `theokit generate schedule` finds the `chat` agent by the rule the agent scanner serves it by:
 * `<agentsDir>/chat.{ts,tsx,js,jsx}` or `<agentsDir>/chat/index.{ts,tsx,js,jsx}`, and nothing under
 * a composition sub-folder (`tools/`, `skills/`, ...) or a test file. The schedule imports the file
 * the build actually serves, so an app whose chat agent the framework mounts is never told to
 * create it.
 */
const REPO = resolve(__dirname, '../..')
const SCAFFOLD_CONFIG = resolve(REPO, 'packages/create-theokit/templates/default/theo.config.ts')
const AGENTS = 'src/server/agents'

/** A scaffold-layout project whose only agent file is `agentFile` (relative to the agents dir). */
function projectWithAgentAt(agentFile: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'theo-gen-schedule-chat-form-'))
  copyFileSync(SCAFFOLD_CONFIG, join(dir, 'theo.config.ts'))
  writeFileSync(join(dir, 'package.json'), '{ "type": "module" }\n')
  mkdirSync(join(dir, 'node_modules'), { recursive: true })
  symlinkSync(resolve(REPO, 'packages/theo'), join(dir, 'node_modules/theokit'), 'dir')
  const agentPath = join(dir, AGENTS, agentFile)
  mkdirSync(dirname(agentPath), { recursive: true })
  writeFileSync(agentPath, "export const policy = 'public'\nexport default {}\n")
  return dir
}

function chatImport(dir: string): string | undefined {
  const source = readFileSync(join(dir, AGENTS, 'schedules/daily-digest.ts'), 'utf8')
  return /^import chat from '([^']+)'$/m.exec(source)?.[1]
}

describe('a schedule runs the chat agent the build serves', () => {
  it.each([
    ['chat.ts', '../chat.js'],
    ['chat.tsx', '../chat.js'],
    ['chat.js', '../chat.js'],
    ['chat.jsx', '../chat.jsx'],
    ['chat/index.ts', '../chat/index.js'],
    ['chat/index.tsx', '../chat/index.js'],
    ['chat/index.jsx', '../chat/index.jsx'],
  ])('test_a_chat_agent_at_%s_is_imported_as_%s', async (agentFile, specifier) => {
    const dir = projectWithAgentAt(agentFile)
    try {
      const result = await generate({ cwd: dir, type: 'schedule', name: 'daily-digest' })

      expect(result.status).toBe('created')
      expect(chatImport(dir)).toBe(specifier)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it.each(['tools/chat.ts', 'chat.test.ts', 'chat.md'])(
    'test_a_file_the_build_does_not_serve_as_chat_is_not_the_chat_agent_%s',
    async (agentFile) => {
      const dir = projectWithAgentAt(agentFile)
      try {
        const result = await generate({ cwd: dir, type: 'schedule', name: 'daily-digest' })

        expect(result.status).toBe('agent_not_found')
        expect(existsSync(join(dir, AGENTS, 'schedules'))).toBe(false)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    },
  )
})
