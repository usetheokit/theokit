import { describe, it, expect, vi } from 'vitest'
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
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { generate, generateCommand } from '../../packages/theo/src/cli/commands/generate.js'
import { scanCronDirs } from '../../packages/theo/src/server/cron/cron-scan.js'

const REPO = resolve(__dirname, '../..')
const SCAFFOLD_CONFIG = resolve(REPO, 'packages/create-theokit/templates/default/theo.config.ts')

/**
 * A project at `<tmp>/app` whose `agentsDir` points outside it, with a real `chat` agent waiting
 * there so the agent lookup succeeds and the containment check is what decides.
 */
function projectWithExternalAgentsDir(tmp: string, agentsDir: string): string {
  const app = join(tmp, 'app')
  mkdirSync(app, { recursive: true })
  writeFileSync(join(app, 'theo.config.ts'), `export default { agentsDir: '${agentsDir}' }\n`)
  writeFileSync(join(app, 'package.json'), '{}')
  const external = join(app, agentsDir)
  mkdirSync(external, { recursive: true })
  writeFileSync(join(external, 'chat.ts'), 'export default {}\n')
  return app
}

describe('a schedule is written only where it can run', () => {
  it('test_an_agents_dir_outside_the_project_writes_nothing', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'theo-gen-schedule-outside-'))
    try {
      const app = projectWithExternalAgentsDir(tmp, '../elsewhere/agents')

      const result = await generate({ cwd: app, type: 'schedule', name: 'daily-digest' })

      expect(result.status).toBe('invalid_name')
      expect(result.message).toContain('outside the project root')
      expect(existsSync(join(tmp, 'elsewhere/agents/schedules/daily-digest.ts'))).toBe(false)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('test_the_cli_names_an_agents_dir_outside_the_project_as_path_traversal', async () => {
    // F-00958182: the CLI printed a fixed "Invalid name ... Use kebab-case" for a valid name, so
    // the user was told to rename the schedule and never that the configured agentsDir escaped.
    const tmp = mkdtempSync(join(tmpdir(), 'theo-gen-schedule-cli-outside-'))
    const cwd = vi.spyOn(process, 'cwd')
    try {
      const app = projectWithExternalAgentsDir(tmp, '../outside')
      cwd.mockReturnValue(app)

      const run = generateCommand('schedule', 'escaped')

      await expect(run).rejects.toThrow(/^Path traversal denied: ".*" is outside the project root /)
      expect(existsSync(join(tmp, 'outside/schedules/escaped.ts'))).toBe(false)
    } finally {
      cwd.mockRestore()
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('test_a_sibling_directory_sharing_the_project_prefix_is_outside', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'theo-gen-schedule-prefix-'))
    try {
      const app = projectWithExternalAgentsDir(tmp, '../app-outside/agents')

      const result = await generate({ cwd: app, type: 'schedule', name: 'daily-digest' })

      expect(result.status).toBe('invalid_name')
      expect(result.message).toContain('outside the project root')
      expect(existsSync(join(tmp, 'app-outside/agents/schedules/daily-digest.ts'))).toBe(false)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('test_a_nested_schedule_imports_its_agent', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'theo-gen-schedule-nested-'))
    try {
      copyFileSync(SCAFFOLD_CONFIG, join(dir, 'theo.config.ts'))
      writeFileSync(join(dir, 'package.json'), '{ "type": "module" }\n')
      mkdirSync(join(dir, 'node_modules/@theokit'), { recursive: true })
      symlinkSync(resolve(REPO, 'packages/theo'), join(dir, 'node_modules/theokit'), 'dir')
      symlinkSync(
        resolve(REPO, 'packages/agents'),
        join(dir, 'node_modules/@theokit/agents'),
        'dir',
      )
      mkdirSync(join(dir, 'src/server/agents'), { recursive: true })
      writeFileSync(join(dir, 'src/server/agents/chat.ts'), 'export default {}\n')

      const result = await generate({ cwd: dir, type: 'schedule', name: 'reports/daily' })

      expect(result.status).toBe('created')
      const source = readFileSync(join(dir, 'src/server/agents/schedules/reports/daily.ts'), 'utf8')
      expect(source).toMatch(/^import chat from '\.\.\/\.\.\/chat\.js'$/m)
      const nodes = await scanCronDirs([
        join(dir, 'src/server/crons'),
        join(dir, 'src/server/agents/schedules'),
      ])
      expect(nodes).toHaveLength(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
