import { describe, it, expect } from 'vitest'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { generate } from '../../packages/theo/src/cli/commands/generate.js'

/**
 * `theokit generate schedule` resolves where to write from the project's own config and the agent
 * the schedule runs. When either cannot be resolved it refuses by name and writes nothing, rather
 * than falling back to a directory the build never scans.
 */
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
})
