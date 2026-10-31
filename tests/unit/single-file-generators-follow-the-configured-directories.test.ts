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
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { generate } from '../../packages/theo/src/cli/commands/generate.js'
import { scanAgents } from '../../packages/theo/src/server/scan/agent-scan.js'

/**
 * Every single-file generator wrote under a hardcoded `server/`, `app/` or `agents/`
 * (usetheokit/theokit#1031). The scaffold `create-theokit` ships declares `src/app`, `src/server`
 * and `src/server/agents`, so `theokit generate route hello` there wrote `./server/routes/hello.ts`,
 * a file no scanner reads, and reported success.
 */
const REPO = resolve(__dirname, '../..')
const SCAFFOLD_CONFIG = resolve(REPO, 'packages/create-theokit/templates/default/theo.config.ts')

let dir: string

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'theo-gen-layout-'))
  copyFileSync(SCAFFOLD_CONFIG, join(dir, 'theo.config.ts'))
  writeFileSync(join(dir, 'package.json'), '{ "type": "module" }\n')
  // `loadConfig` imports the copied config, which imports `theokit`.
  mkdirSync(join(dir, 'node_modules'), { recursive: true })
  symlinkSync(resolve(REPO, 'packages/theo'), join(dir, 'node_modules', 'theokit'), 'dir')
})

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

const EXPECTED: [kind: string, name: string, path: string][] = [
  ['route', 'hello', 'src/server/routes/hello.ts'],
  ['action', 'send-mail', 'src/server/actions/send-mail.ts'],
  ['page', 'about', 'src/app/about/page.tsx'],
  ['ws', 'chat-room', 'src/server/ws/chat-room.ts'],
  ['controller', 'users', 'src/server/controllers/users.controller.ts'],
  ['agent', 'support', 'src/server/agents/support.ts'],
  ['toolbox', 'math', 'src/server/toolboxes/math.tools.ts'],
  ['workflow', 'greeting', 'src/server/agents/workflows/greeting.ts'],
  ['eval', 'qa-smoke', 'src/server/agents/evals/qa-smoke.ts'],
  ['sandbox', 'run-command', 'src/server/agents/sandbox/run-command.ts'],
  ['memory', 'conversations', 'src/server/agents/memory/conversations.ts'],
]

describe('single-file generators follow appDir, serverDir and agentsDir', () => {
  it.each(EXPECTED)('generate %s %s writes %s', async (kind, name, path) => {
    const result = await generate({ cwd: dir, type: kind, name })
    expect(result).toMatchObject({ status: 'created', filePath: join(dir, path) })
    expect(existsSync(join(dir, path))).toBe(true)
    expect(existsSync(join(dir, path.replace(/^src\//, '')))).toBe(false)
  })

  it('the action test lands beside the action', () => {
    expect(existsSync(join(dir, 'src/server/actions/send-mail.test.ts'))).toBe(true)
  })

  it('the generated agent is served under its own name and declares a policy', () => {
    // `scanAgents` throws MissingAgentPolicyError on an agent with no `policy` export, which would
    // fail `theokit build` for the whole app.
    const agents = scanAgents(dir, 'src/server/agents')
    expect(agents.map((a) => a.agentPath)).toEqual(['/api/agents/support'])
    expect(readFileSync(join(dir, 'src/server/agents/support.ts'), 'utf-8')).toContain(
      'src/server/agents/support.ts still carries the policy the generator wrote',
    )
  })

  it('the generated route names its own path in the placeholder policy', () => {
    expect(readFileSync(join(dir, 'src/server/routes/hello.ts'), 'utf-8')).toContain(
      "'src/server/routes/hello.ts still carries the policy",
    )
  })

  it('a config that cannot be read is refused by name and nothing is written', async () => {
    const broken = mkdtempSync(join(tmpdir(), 'theo-gen-layout-broken-'))
    try {
      writeFileSync(join(broken, 'package.json'), '{ "type": "module" }\n')
      writeFileSync(join(broken, 'theo.config.ts'), "throw new Error('boom')\n")
      const result = await generate({ cwd: broken, type: 'route', name: 'hello' })
      expect(result.status).toBe('invalid_config')
      expect(result.message).toContain('boom')
      expect(existsSync(join(broken, 'server'))).toBe(false)
    } finally {
      rmSync(broken, { recursive: true, force: true })
    }
  })
})
