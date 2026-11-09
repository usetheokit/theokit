import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

/**
 * The jobs that build and run TheoClaw against a real model (#1235, #1273). A dispatch on 2026-11-09
 * failed on all three runners before any test ran: Linux on Node 22.12 (`.nvmrc`, the framework's
 * floor) while TheoClaw needs 22.16, Windows because `pnpm` is a `.cmd` shim that spawnSync cannot
 * start without a shell, and macOS because the type build ran out of heap.
 */
interface Step {
  name?: string
  uses?: string
  run?: string
  env?: Record<string, string>
  with?: Record<string, unknown>
}

interface Workflow {
  jobs: Record<string, { steps: Step[] }>
}

const ROOT = resolve(__dirname, '../..')
const workflow = (file: string) =>
  parse(readFileSync(resolve(ROOT, '.github/workflows', file), 'utf8')) as Workflow

const setupOf = (steps: Step[]) =>
  steps.find((step) => step.uses?.startsWith('usetheokit/shared-workflows/actions/setup@'))

describe('the live TheoClaw jobs', () => {
  it('run the live-model job on the newest Node 22, which TheoClaw requires over the 22.12 floor', () => {
    const steps = workflow('live-model.yml').jobs['live-model'].steps
    expect(setupOf(steps)?.with?.['node-version']).toBe('22')
  })

  it('run the daemon legs on the newest Node 22', () => {
    const steps = workflow('theoclaw-daemon.yml').jobs['theoclaw-daemon'].steps
    expect(setupOf(steps)?.with?.['node-version']).toBe('22')
  })

  it('give the daemon build enough heap for the type build on a macOS runner', () => {
    const steps = workflow('theoclaw-daemon.yml').jobs['theoclaw-daemon'].steps
    const build = steps.find((step) => step.run?.includes('live-model-build.mjs theoclaw'))
    expect(build?.env?.NODE_OPTIONS).toMatch(/--max-old-space-size=\d{4,}/)
  })

  it('start pnpm through a shell on Windows, where it is a .cmd shim', () => {
    const script = readFileSync(resolve(ROOT, 'scripts/live-model-build.mjs'), 'utf8')
    expect(script).toMatch(
      /spawnSync\('pnpm', args, \{[\s\S]*?shell: process\.platform === 'win32',\n\s*\}\)/,
    )
  })
})
