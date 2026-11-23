import { mkdirSync, utimesSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { Generations } from '../src/sessions/generations.js'
import { collectTranscripts } from '../src/sessions/transcript-gc.js'
import { sessionsCommand } from '../src/sessions/sessions-command.js'
import { scratchDir } from './support/cli-harness.js'
import { Writable } from 'node:stream'

const DAY = 86_400_000

function setup(files: Record<string, number>): {
  workspace: string
  paths: Record<string, string>
} {
  const workspace = scratchDir()
  const dir = join(workspace, '.theoclaw', 'projects', workspace.replace(/[^a-zA-Z0-9]/g, '-'))
  mkdirSync(dir, { recursive: true })
  const paths: Record<string, string> = {}
  for (const [id, ageDays] of Object.entries(files)) {
    const file = join(dir, `${id}.jsonl`)
    writeFileSync(
      file,
      `${JSON.stringify({ type: 'user', sessionId: id, message: { content: [{ type: 'text', text: 'hi' }] } })}\n`,
    )
    const at = new Date(Date.now() - ageDays * DAY)
    utimesSync(file, at, at)
    paths[id] = file
  }
  return { workspace, paths }
}

const FILES = {
  'theoclaw-a-g0': 1,
  'theoclaw-a-g1': 90,
  'theoclaw-b-g0': 60,
  'theoclaw-b-g1': 50,
  'theoclaw-c-g0': 70,
  'theoclaw-c-g1': 5,
}

async function generations(): Promise<Generations> {
  const g = new Generations()
  await g.next('b') // b is at generation 1 ...
  await g.next('b') // ... then 2: g1 is retired
  await g.next('c')
  await g.next('a')
  return g
}

describe('collectTranscripts', () => {
  it('removes old retired transcripts, keeps new ones and the current chat one', async () => {
    const { workspace, paths } = setup({ ...FILES, 'theoclaw-d-g0': 90 })
    const g = await generations()
    const result = await collectTranscripts({ workspace, generations: g }, 30, true)
    expect(existsSync(paths['theoclaw-a-g0']!)).toBe(true) // young
    expect(existsSync(paths['theoclaw-c-g1']!)).toBe(true) // young
    expect(existsSync(paths['theoclaw-d-g0']!)).toBe(true) // old but d is still at generation 0
    expect(existsSync(paths['theoclaw-c-g0']!)).toBe(false)
    expect(existsSync(paths['theoclaw-b-g0']!)).toBe(false)
    expect(existsSync(paths['theoclaw-b-g1']!)).toBe(false)
    expect([...result.removed].sort()).toEqual(['theoclaw-b-g0', 'theoclaw-b-g1', 'theoclaw-c-g0'])
  })

  it('keeps a retired generation the daemon still holds', async () => {
    const { workspace, paths } = setup(FILES)
    const result = await collectTranscripts(
      { workspace, generations: await generations(), heldIds: () => ['theoclaw-b-g1'] },
      30,
      true,
    )
    expect(existsSync(paths['theoclaw-b-g1']!)).toBe(true)
    expect(result.removed).not.toContain('theoclaw-b-g1')
  })

  it('removes nothing in a dry run and lists what it would remove', async () => {
    const { workspace, paths } = setup(FILES)
    const result = await collectTranscripts(
      { workspace, generations: await generations() },
      30,
      false,
    )
    expect(result.dryRun).toBe(true)
    expect(result.removed.length).toBeGreaterThan(0)
    for (const path of Object.values(paths)) expect(existsSync(path)).toBe(true)
  })
})

describe('theoclaw sessions gc', () => {
  it('prints what a dry run would remove and removes nothing', async () => {
    const { workspace, paths } = setup({
      'theoclaw-x-g0': 90,
      'theoclaw-x-g1': 80,
      'theoclaw-y-g0': 1,
    })
    writeFileSync(
      join(workspace, '.theoclaw', 'sessions.json'),
      JSON.stringify({ version: 1, generations: { x: 1 } }),
    )
    let out = ''
    const stdout = new Writable({ write: (chunk, _e, done) => ((out += String(chunk)), done()) })
    const io = {
      env: { THEOCLAW_WORKSPACE: workspace },
      homeDir: workspace,
      stdout,
      stderr: stdout,
    }
    expect(await sessionsCommand(['gc', '--dry-run'], io)).toBe(0)
    expect(out).toContain('would remove theoclaw-x-g0')
    expect(existsSync(paths['theoclaw-x-g0']!)).toBe(true)
    out = ''
    expect(await sessionsCommand(['gc'], io)).toBe(0)
    expect(existsSync(paths['theoclaw-x-g0']!)).toBe(false)
    expect(existsSync(paths['theoclaw-x-g1']!)).toBe(true)
  })
})
