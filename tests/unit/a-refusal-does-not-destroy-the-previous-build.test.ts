/**
 * A build that refuses must not empty the output first.
 *
 * `buildCommand` runs `cleanOutDir` at `build.ts:67` and validates the target at `:72`, so the clean
 * happens before anything has checked that the target even exists. Measured 2026-09-28 on a real project:
 *
 *     theokit build                       ->  exit 0,  302 files in .theokit/client/assets
 *     theokit build --target not-a-target   ->  exit 1,  0 files
 *     ✗ Invalid build target "not-a-target". Available targets: node, vercel, cloudflare, …
 *
 * One mistyped character costs a working build, and nothing in the error says anything was destroyed.
 *
 * The same order defeats two refusals that are decidable from the target and the config alone: the
 * `aws-lambda` streaming refusal (302 files -> 0 on a project with `ssrStreaming: true`) and
 * `assertRateLimitEnforceable`, whose own comment at `build.ts:245-248` claims the combination is
 * "refused by name, BEFORE the build writes anything". It is reached from `runAdapterBuild` at `:167`.
 * The intent was written down; the order defeated it.
 *
 * ## What is mocked, and why only this much
 *
 * `loadConfig`, because loading a TypeScript config in a unit test would drag the config loader into a
 * test about ordering; and the clean itself, because the assertion IS that it was not reached. Nothing
 * else — `preflightNodeAndBindings`, `loadEnv` and `validateProjectStructure` run for real against a
 * temp project, so a refusal that happened for one of THEIR reasons would not be mistaken for this one.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const cleanOutDir = vi.fn(async () => {})

vi.mock('../../packages/theo/src/cli/cleanup/cleanup.js', () => ({ cleanOutDir }))

// The fixture config is the SCHEMA's own defaults plus the three fields this test needs. Hand-writing
// the object meant chasing one missing field per run — `agentsDir`, then something a `paths[1]` join
// reads, then something `Object.keys` reads — and each failure was a DIFFERENT failure, so the case
// proved nothing about ordering while it looked like a red test.
vi.mock('../../packages/theo/src/config/load-config.js', async () => {
  const { theoConfigSchema } = await import('../../packages/theo/src/config/schema.js')
  const config = theoConfigSchema.parse({
    appDir: 'src/app',
    serverDir: 'src/server',
    agentsDir: 'src/server/agents',
    ssr: true,
    ssrStreaming: true,
  })
  return { loadConfig: async () => config }
})

let project = ''
let previous = ''

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'theokit-refusal-'))
  mkdirSync(join(project, 'src', 'app'), { recursive: true })
  mkdirSync(join(project, 'src', 'server', 'routes'), { recursive: true })
  // `validateProjectStructure` requires both to EXIST; it does not read them, and `loadConfig` is
  // mocked, so the contents are deliberately the smallest thing that is still valid on disk.
  writeFileSync(join(project, 'theo.config.ts'), 'export default {}\n', 'utf8')
  writeFileSync(
    join(project, 'package.json'),
    '{"name":"refusal-fixture","type":"module"}\n',
    'utf8',
  )
  previous = process.cwd()
  process.chdir(project)
  cleanOutDir.mockClear()
})

afterEach(() => {
  process.chdir(previous)
  rmSync(project, { recursive: true, force: true })
})

describe('a refusal does not destroy the previous build', () => {
  it('an unknown target is refused before anything is emptied', async () => {
    const { buildCommand } = await import('../../packages/theo/src/cli/commands/build.js')

    await expect(buildCommand({ target: 'not-a-target' })).rejects.toThrow(/Invalid build target/)

    expect(
      cleanOutDir,
      'the output was emptied before the target was checked, so a mistyped target name destroys a ' +
        'working build and the error message only mentions the typo',
    ).not.toHaveBeenCalled()
  })

  it('a target that cannot stream is refused before anything is emptied', async () => {
    // The config above carries `ssrStreaming: true`, and `aws-lambda` declares
    // `streamsResponses: false`. That is decidable from the target and the config alone.
    const { buildCommand } = await import('../../packages/theo/src/cli/commands/build.js')

    await expect(buildCommand({ target: 'aws-lambda' })).rejects.toThrow(/does not stream/)

    expect(
      cleanOutDir,
      'the aws-lambda refusal is reached from inside the adapter build, a hundred lines after the ' +
        'clean — so a project with ssrStreaming on loses its build to a refusal about streaming',
    ).not.toHaveBeenCalled()
  })

  it('the probe is real: a refusal for an unrelated reason still reaches the clean', async () => {
    // COUNTERPROOF. `not.toHaveBeenCalled()` also passes over a mock that is wired to nothing, over an
    // import that failed, and over a `buildCommand` that threw before reaching any of this. A target
    // that IS valid and CAN stream must get past the validations and reach the clean — whatever it
    // fails at afterwards, in a temp project with no real app to build.
    const { buildCommand } = await import('../../packages/theo/src/cli/commands/build.js')

    await buildCommand({ target: 'node' }).catch(() => undefined)

    expect(
      cleanOutDir,
      'the clean was never reached even for a valid target, so the two assertions above prove nothing',
    ).toHaveBeenCalled()
  })
})
