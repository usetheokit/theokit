import { describe, it, expect } from 'vitest'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { generate } from '../../packages/theo/src/cli/commands/generate.js'

/**
 * `theokit generate schedule` resolves where to write from the project's own config and the agent
 * the schedule runs. When either cannot be resolved it refuses by name and writes nothing, rather
 * than falling back to a directory the build never scans.
 */
const REPO = resolve(__dirname, '../..')
const SCAFFOLD_CONFIG = resolve(REPO, 'packages/create-theokit/templates/default/theo.config.ts')

/** The scaffold config imports `theokit`, so the temp project resolves the framework from disk. */
function linkFramework(projectDir: string): void {
  const nodeModules = join(projectDir, 'node_modules')
  mkdirSync(nodeModules, { recursive: true })
  symlinkSync(resolve(REPO, 'packages/theo'), join(nodeModules, 'theokit'), 'dir')
}

describe('theokit generate schedule refuses what it cannot resolve', () => {
  it('test_an_unreadable_config_is_refused_not_guessed', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'theo-gen-schedule-config-'))
    try {
      // The config imports a package this project never installed, so loading it throws.
      writeFileSync(
        join(dir, 'theo.config.ts'),
        "import { x } from 'missing-package'\nexport default x\n",
      )
      writeFileSync(join(dir, 'package.json'), '{}')

      const result = await generate({ cwd: dir, type: 'schedule', name: 'daily-digest' })

      expect(result.status).toBe('invalid_config')
      expect(result.message).toContain('theo.config.ts')
      expect(result.message).toContain('missing-package')
      expect(existsSync(join(dir, 'agents'))).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('test_a_missing_agent_is_refused_by_name', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'theo-gen-schedule-agent-'))
    try {
      copyFileSync(SCAFFOLD_CONFIG, join(dir, 'theo.config.ts'))
      writeFileSync(join(dir, 'package.json'), '{}')
      linkFramework(dir)

      const result = await generate({ cwd: dir, type: 'schedule', name: 'daily-digest' })

      expect(result.status).toBe('agent_not_found')
      expect(result.message).toContain('src/server/agents')
      expect(existsSync(join(dir, 'src/server/agents/schedules'))).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
