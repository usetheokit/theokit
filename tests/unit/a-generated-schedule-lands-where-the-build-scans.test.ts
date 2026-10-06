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
 * `theokit build` discovers crons in `<serverDir>/crons` and `<agentsDir>/schedules`
 * (packages/theo/src/cli/commands/build.ts, emitCronArtifacts). The scaffold that
 * `create-theokit` ships declares `agentsDir('src/server/agents')`, so a schedule produced
 * by `theokit generate schedule` in that app must land under `src/server/agents/schedules`,
 * or the build reports `Crons: 0 declared` and nothing ever runs.
 */
const SCAFFOLD_CONFIG = resolve(
  __dirname,
  '../../packages/create-theokit/templates/default/theo.config.ts',
)

const REPO = resolve(__dirname, '../..')

/**
 * `loadConfig` imports the copied `theo.config.ts`, which imports `theokit`, so the temp
 * project needs the framework resolvable from its own `node_modules` (same helper as
 * `tests/integration/wave1-mandatory.test.ts`).
 */
function linkFramework(projectDir: string): void {
  const nodeModules = join(projectDir, 'node_modules')
  mkdirSync(nodeModules, { recursive: true })
  symlinkSync(resolve(REPO, 'packages/theo'), join(nodeModules, 'theokit'), 'dir')
}

describe('theokit generate schedule in a scaffolded app', () => {
  it('test_a_generated_schedule_lands_where_the_build_scans', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'theo-gen-schedule-'))
    try {
      copyFileSync(SCAFFOLD_CONFIG, join(dir, 'theo.config.ts'))
      writeFileSync(join(dir, 'package.json'), '{}')
      linkFramework(dir)
      // A schedule runs the app's `chat` agent, so the project declares one.
      mkdirSync(join(dir, 'src/server/agents'), { recursive: true })
      writeFileSync(join(dir, 'src/server/agents/chat.ts'), 'export default {}\n')

      const result = await generate({ cwd: dir, type: 'schedule', name: 'daily-digest' })

      expect(result.status).toBe('created')
      expect(result.filePath).toBe(join(dir, 'src/server/agents/schedules/daily-digest.ts'))
      expect(existsSync(join(dir, 'src/server/agents/schedules/daily-digest.ts'))).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
