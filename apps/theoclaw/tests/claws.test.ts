import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'

import { readPersonaPrompt } from '../src/agent/persona-files.js'
import { clawsCommand } from '../src/routing/claws.js'
import { readAgentRouter } from '../src/routing/routing-env.js'

describe('theoclaw claws', () => {
  it('adds an agent that answers with the package persona, updates it and removes it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'claws-'))
    const pkg = join(dir, 'pkg')
    mkdirSync(join(pkg, 'skills'), { recursive: true })
    writeFileSync(join(pkg, 'claw.json'), JSON.stringify({ id: 'pirate', routes: ['slack'] }))
    writeFileSync(join(pkg, 'SOUL.md'), 'Talk like a pirate.')
    const env = { THEOCLAW_STATE_DIR: join(dir, 'state') }
    const run = (args: string[]): Promise<number> =>
      clawsCommand(args, { env, homeDir: dir, cwd: dir, stdout: new PassThrough(), stderr: new PassThrough() })

    expect(readAgentRouter(env, '/main')).toBeUndefined()
    expect(await run(['add', './pkg'])).toBe(0)
    await expect(run(['add', './pkg'])).rejects.toThrow(/already installed/)
    const router = readAgentRouter(env, '/main')!
    const profile = router.route({ platform: 'slack', peer: 'u1' })
    expect(profile.id).toBe('pirate')
    expect(readPersonaPrompt(profile.workspace)).toContain('Talk like a pirate.')
    expect(router.route({ platform: 'matrix' }).id).toBe('main')

    writeFileSync(join(pkg, 'SOUL.md'), 'Talk like a poet.')
    expect(await run(['update', './pkg'])).toBe(0)
    expect(readFileSync(join(profile.workspace, 'SOUL.md'), 'utf8')).toBe('Talk like a poet.')

    expect(await run(['remove', 'pirate'])).toBe(0)
    expect(existsSync(profile.workspace)).toBe(false)
    expect(readAgentRouter(env, '/main')).toBeUndefined()
    await expect(run(['remove', 'pirate'])).rejects.toThrow(/no agent/)
  })
})
