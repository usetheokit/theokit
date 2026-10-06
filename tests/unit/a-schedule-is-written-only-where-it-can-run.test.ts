import { describe, it, expect } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { generate } from '../../packages/theo/src/cli/commands/generate.js'

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
})
