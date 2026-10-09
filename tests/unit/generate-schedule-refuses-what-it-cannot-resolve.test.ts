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
      expect(result.message).toContain(`Cannot read ${join(dir, 'theo.config.ts')}:`)
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

  it('test_the_cli_reports_the_unreadable_config_generate_computed', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'theo-gen-schedule-cli-config-'))
    const cwd = vi.spyOn(process, 'cwd')
    try {
      writeFileSync(
        join(dir, 'theo.config.ts'),
        "import { x } from 'missing-package'\nexport default x\n",
      )
      writeFileSync(join(dir, 'package.json'), '{}')
      cwd.mockReturnValue(dir)
      const computed = await generate({ cwd: dir, type: 'schedule', name: 'daily-digest' })

      const run = generateCommand('schedule', 'daily-digest')

      expect(computed.status).toBe('invalid_config')
      await expect(run).rejects.toThrow(computed.message)
      await expect(run).rejects.toThrow(/missing-package/)
    } finally {
      cwd.mockRestore()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('test_the_cli_reports_the_missing_agent_generate_computed', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'theo-gen-schedule-cli-agent-'))
    const cwd = vi.spyOn(process, 'cwd')
    try {
      copyFileSync(SCAFFOLD_CONFIG, join(dir, 'theo.config.ts'))
      writeFileSync(join(dir, 'package.json'), '{}')
      linkFramework(dir)
      cwd.mockReturnValue(dir)
      const computed = await generate({ cwd: dir, type: 'schedule', name: 'daily-digest' })

      const run = generateCommand('schedule', 'daily-digest')

      expect(computed.status).toBe('agent_not_found')
      await expect(run).rejects.toThrow(computed.message)
      await expect(run).rejects.toThrow(join(dir, 'src/server/agents'))
    } finally {
      cwd.mockRestore()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('test_generating_an_existing_schedule_answers_already_exists', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'theo-gen-schedule-twice-'))
    try {
      copyFileSync(SCAFFOLD_CONFIG, join(dir, 'theo.config.ts'))
      writeFileSync(join(dir, 'package.json'), '{}')
      linkFramework(dir)
      mkdirSync(join(dir, 'src/server/agents'), { recursive: true })
      writeFileSync(join(dir, 'src/server/agents/chat.ts'), 'export default {}\n')
      const schedule = join(dir, 'src/server/agents/schedules/daily-digest.ts')
      const first = await generate({ cwd: dir, type: 'schedule', name: 'daily-digest' })
      writeFileSync(schedule, '// edited by the user\n')

      const second = await generate({ cwd: dir, type: 'schedule', name: 'daily-digest' })

      expect(first.status).toBe('created')
      expect(second.status).toBe('already_exists')
      expect(second.filePath).toBe(schedule)
      expect(readFileSync(schedule, 'utf8')).toBe('// edited by the user\n')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
