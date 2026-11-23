import { EventEmitter } from 'node:events'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import {
  defineInstanceConfig,
  InstanceConfigError,
  type OnboardIo,
} from '../../src/instance-config/index.js'

function fakeTty() {
  const stdin = Object.assign(new EventEmitter(), {
    isTTY: true,
    setRawMode: vi.fn(),
    resume: vi.fn(),
    pause: vi.fn(),
  })
  const out: string[] = []
  const stdout = { write: (s: string) => (out.push(s), true) }
  return { stdin: stdin as typeof stdin & OnboardIo['stdin'], stdout, out }
}

const setup = () => {
  const dir = mkdtempSync(join(tmpdir(), 'onboard-'))
  const file = join(dir, 'cfg', 'a.env')
  const config = defineInstanceConfig({
    app: 'my-agent',
    keys: {
      MODEL: {},
      API_KEY: { secret: true },
      PORT: {
        parse: (v: string) => {
          if (!/^\d+$/.test(v)) throw new Error(`bad ${v}`)
        },
      },
    },
  })
  const env = { MY_AGENT_CONFIG: file } as NodeJS.ProcessEnv
  return { dir, file, config, env }
}
const feed = (t: ReturnType<typeof fakeTty>, ...lines: string[]) => {
  let i = 0
  t.stdin.setRawMode.mockImplementation((m: boolean) => {
    if (m && i < lines.length) queueMicrotask(() => t.stdin.emit('data', lines[i++]))
  })
}

describe('onboard', () => {
  it('hides the secret, restores raw mode, writes the file', async () => {
    const { config, env, file } = setup()
    const t = fakeTty()
    // each prompt arms raw mode once; feed answers in order
    const answers = ['m1\r', 'sk-secret\r', '8080\r']
    let n = 0
    t.stdin.setRawMode.mockImplementation((m: boolean) => {
      if (m) queueMicrotask(() => t.stdin.emit('data', answers[n++]))
    })
    const r = await config.onboard(
      { stdin: t.stdin, stdout: t.stdout as never, env, homeDir: '/h' },
      { interactive: true },
    )
    expect(r.written).toEqual(['MODEL', 'API_KEY', 'PORT'])
    expect(t.out.join('')).not.toContain('sk-secret')
    expect(t.stdin.setRawMode).toHaveBeenLastCalledWith(false)
    expect(readFileSync(file, 'utf8')).toContain('API_KEY="sk-secret"')
  })

  it('restores raw mode after Ctrl-C', async () => {
    const { config, env, file } = setup()
    const t = fakeTty()
    feed(t, '\u0003')
    await expect(
      config.onboard(
        { stdin: t.stdin, stdout: t.stdout as never, env, homeDir: '/h' },
        { interactive: true },
      ),
    ).rejects.toBeInstanceOf(InstanceConfigError)
    expect(t.stdin.setRawMode).toHaveBeenCalledWith(false)
    expect(existsSync(file)).toBe(false)
  })

  it('throws without a TTY when interactive', async () => {
    const { config, env } = setup()
    const t = fakeTty()
    t.stdin.isTTY = false
    await expect(
      config.onboard(
        { stdin: t.stdin, stdout: t.stdout as never, env, homeDir: '/h' },
        { interactive: true },
      ),
    ).rejects.toThrow('onboarding needs a terminal; pass the answers instead')
  })

  it('names an unset variable', async () => {
    const { config, env } = setup()
    const t = fakeTty()
    await expect(
      config.onboard(
        { stdin: t.stdin, stdout: t.stdout as never, env, homeDir: '/h' },
        {
          interactive: false,
          answers: { MODEL: 'm', PORT: '1' },
          secretFromEnv: { API_KEY: 'NOPE_KEY' },
        },
      ),
    ).rejects.toMatchObject({ variable: 'NOPE_KEY' })
  })

  it('writes nothing when parse or validate fails; refuses existing without force', async () => {
    const { config, env, file } = setup()
    const t = fakeTty()
    const io = {
      stdin: t.stdin,
      stdout: t.stdout as never,
      env: { ...env, K: 'sk' },
      homeDir: '/h',
    }
    const base = { interactive: false, secretFromEnv: { API_KEY: 'K' } }
    await expect(
      config.onboard(io, { ...base, answers: { MODEL: 'm', PORT: 'x' } }),
    ).rejects.toBeInstanceOf(InstanceConfigError)
    await expect(
      config.onboard(io, {
        ...base,
        answers: { MODEL: 'm', PORT: '1' },
        validate: () => {
          throw new Error('leaks sk')
        },
      }),
    ).rejects.toThrow(/refused by validate/)
    expect(existsSync(file)).toBe(false)
    await config.onboard(io, { ...base, answers: { MODEL: 'm', PORT: '1' } })
    await expect(
      config.onboard(io, { ...base, answers: { MODEL: 'n', PORT: '2' } }),
    ).rejects.toMatchObject({
      code: 'instance_config_exists',
    })
    expect(readFileSync(file, 'utf8')).toContain('MODEL="m"')
    await config.onboard(io, { ...base, answers: { MODEL: 'n', PORT: '2' }, force: true })
    expect(readFileSync(file, 'utf8')).toContain('MODEL="n"')
  })
})

describe('generated key', () => {
  it('writes generate() and asks nothing for it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'onboard-'))
    const file = join(dir, 'a.env')
    const generate = vi.fn(() => 'tok-123')
    const config = defineInstanceConfig({
      app: 'my-agent',
      keys: { MODEL: {}, TOKEN: { secret: true, generate } },
    })
    const t = fakeTty()
    feed(t, 'm1\r')
    const result = await config.onboard(
      { ...t, env: { MY_AGENT_CONFIG: file }, homeDir: dir },
      { interactive: true, answers: { TOKEN: 'ignored' } },
    )
    expect(t.stdin.setRawMode.mock.calls.filter(([m]) => m === true)).toHaveLength(1)
    expect(result.written).toEqual(['MODEL', 'TOKEN'])
    expect(readFileSync(file, 'utf8')).toContain('TOKEN="tok-123"')
    expect(generate).toHaveBeenCalledTimes(1)
  })
})
