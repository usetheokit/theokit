import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'

import { afterEach, describe, expect, it } from 'vitest'

import { type DaemonIo, daemonInstall, daemonStatus, daemonUninstall, type Runner, unitFor, unitPath } from '../src/daemon.js'

const scratch: string[] = []

afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true })
})

interface Call {
  readonly command: string
  readonly args: readonly string[]
}

interface Harness {
  readonly io: DaemonIo
  readonly home: string
  readonly calls: Call[]
  readonly runner: Runner
  readonly stdout: () => string
  readonly stderr: () => string
}

type Answer = { code?: number; stdout?: string; stderr?: string }

/**
 * A scratch home with a built entry and an onboarded configuration file, and a runner that records
 * every command and answers from `answers` by the command's first two words.
 */
function harness(options: { env?: NodeJS.ProcessEnv; platform?: NodeJS.Platform; answers?: Record<string, Answer[]>; configure?: boolean } = {}): Harness {
  const home = mkdtempSync(join(tmpdir(), 'theoclaw-daemon-'))
  scratch.push(home)
  const entry = join(home, 'checkout', 'dist', 'main.js')
  mkdirSync(join(home, 'checkout', 'dist'), { recursive: true })
  writeFileSync(entry, '')
  const workspace = join(home, 'work')
  mkdirSync(workspace)
  const env: NodeJS.ProcessEnv = { XDG_CONFIG_HOME: join(home, 'config'), USER: 'someone', ...options.env }
  if (options.configure !== false) {
    const name = env.THEOCLAW_PROFILE === undefined ? 'theoclaw.env' : `theoclaw-${env.THEOCLAW_PROFILE}.env`
    mkdirSync(join(home, 'config', 'theoclaw'), { recursive: true })
    writeFileSync(join(home, 'config', 'theoclaw', name), `THEOCLAW_WORKSPACE="${workspace}"\n`)
  }
  const calls: Call[] = []
  const answers = options.answers ?? {}
  const runner: Runner = (command, args) => {
    calls.push({ command, args })
    const key = [command, ...args.filter((arg) => arg !== '--user')].slice(0, 2).join(' ')
    const queue = answers[key]
    const answer = queue?.shift() ?? {}
    return Promise.resolve({ code: answer.code ?? 0, stdout: answer.stdout ?? '', stderr: answer.stderr ?? '' })
  }
  let out = ''
  let err = ''
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  stdout.on('data', (chunk: Buffer) => (out += chunk.toString()))
  stderr.on('data', (chunk: Buffer) => (err += chunk.toString()))
  const io: DaemonIo = { env, homeDir: home, cwd: home, platform: options.platform ?? 'linux', nodePath: '/usr/bin/node', entry, stdout, stderr }
  return { io, home, calls, runner, stdout: () => out, stderr: () => err }
}

function unitEnvironment(unit: string): Record<string, string> {
  const pairs = [...unit.matchAll(/^Environment=(?:"([^"]*)"|(\S+))$/gm)].map((match) => (match[1] ?? match[2])!)
  return Object.fromEntries(pairs.map((pair) => [pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1)]))
}

function systemctl(h: Harness): string[] {
  return h.calls.filter((call) => call.command === 'systemctl').map((call) => call.args.join(' '))
}

describe('theoclaw daemon', () => {
  it('the unit runs the built cli with the configuration file', async () => {
    const h = harness()
    expect(await daemonInstall(h.io, h.runner)).toBe(0)

    const path = unitPath('theoclaw', h.home)
    expect(path).toBe(join(h.home, '.config', 'systemd', 'user', 'theoclaw.service'))
    const unit = readFileSync(path, 'utf8')
    const [, node, entry] = /^ExecStart=(\S+) (\S+)$/m.exec(unit)!
    expect(existsSync(entry!)).toBe(true)
    expect(node).toBe('/usr/bin/node')
    expect(unitEnvironment(unit).THEOCLAW_CONFIG).toBe(join(h.home, 'config', 'theoclaw', 'theoclaw.env'))
    expect(unit).toMatch(/^WantedBy=default\.target$/m)
    expect(unit).toMatch(/^Restart=on-failure$/m)
    expect(unit).toContain(`WorkingDirectory=${join(h.home, 'work')}`)
    expect(systemctl(h)).toEqual(['--user daemon-reload', '--user enable --now theoclaw.service'])
  })

  it('daemon refuses a missing configuration and an unsupported platform', async () => {
    const unconfigured = harness({ configure: false })
    expect(await daemonInstall(unconfigured.io, unconfigured.runner)).toBe(1)
    expect(unconfigured.stderr()).toContain(join(unconfigured.home, 'config', 'theoclaw', 'theoclaw.env'))
    expect(unconfigured.stderr()).toContain('theoclaw onboard')
    expect(existsSync(unitPath('theoclaw', unconfigured.home))).toBe(false)
    expect(unconfigured.calls).toEqual([])

    for (const platform of ['darwin', 'win32'] as const) {
      const h = harness({ platform })
      expect(await daemonInstall(h.io, h.runner)).toBe(1)
      expect(h.stderr()).toContain(platform)
      expect(existsSync(unitPath('theoclaw', h.home))).toBe(false)
      expect(h.calls).toEqual([])
    }
  })

  it('daemon removes the unit again when systemctl refuses to start it', async () => {
    const h = harness({ answers: { 'systemctl enable': [{ code: 1, stderr: 'Failed to enable unit: boom' }] } })
    expect(await daemonInstall(h.io, h.runner)).toBe(1)
    expect(h.stderr()).toContain('Failed to enable unit: boom')
    expect(existsSync(unitPath('theoclaw', h.home))).toBe(false)
    expect(systemctl(h).at(-1)).toBe('--user daemon-reload')
  })

  it('uninstall disables, removes the unit and reloads', async () => {
    const h = harness()
    await daemonInstall(h.io, h.runner)
    h.calls.length = 0

    expect(await daemonUninstall(h.io, h.runner)).toBe(0)
    expect(existsSync(unitPath('theoclaw', h.home))).toBe(false)
    expect(systemctl(h)).toEqual(['--user disable --now theoclaw.service', '--user daemon-reload'])
  })

  it('daemon writes an absolute configuration path', async () => {
    const h = harness({ env: { THEOCLAW_CONFIG: 'config/theoclaw/theoclaw.env' } })
    expect(await daemonInstall(h.io, h.runner)).toBe(0)
    const unitEnv = unitEnvironment(readFileSync(unitPath('theoclaw', h.home), 'utf8'))
    expect(unitEnv.THEOCLAW_CONFIG!.startsWith('/')).toBe(true)
    expect(unitEnv.THEOCLAW_CONFIG).toBe(join(h.home, 'config', 'theoclaw', 'theoclaw.env'))
  })

  it('install names enable-linger when lingering is off', async () => {
    const off = harness({ answers: { 'loginctl show-user': [{ stdout: 'Linger=no\n' }] } })
    expect(await daemonInstall(off.io, off.runner)).toBe(0)
    expect(off.stdout()).toContain('loginctl enable-linger')
    expect(off.calls.find((call) => call.command === 'loginctl')?.args).toEqual(['show-user', 'someone', '-p', 'Linger'])

    const on = harness({ answers: { 'loginctl show-user': [{ stdout: 'Linger=yes\n' }] } })
    await daemonInstall(on.io, on.runner)
    expect(on.stdout()).not.toContain('enable-linger')
  })

  it('status exits 0 when the unit is active and 3 otherwise', async () => {
    const h = harness({
      env: { THEOCLAW_PROFILE: 'work' },
      answers: { 'systemctl is-active': [{ stdout: 'active\n' }, { code: 3, stdout: 'inactive\n' }] },
    })
    const codes = [await daemonStatus(h.io, h.runner), await daemonStatus(h.io, h.runner)]
    expect(codes).toEqual([0, 3])
    expect(systemctl(h)).toEqual(['--user is-active theoclaw-work.service', '--user is-active theoclaw-work.service'])
  })

  it('a profiled unit names its profile and a path with a space is quoted', () => {
    const unit = unitFor({ label: 'theoclaw-a', nodePath: '/opt/my node/node', entryPath: '/srv/x/main.js', configPath: '/c/a b.env', profile: 'a', workingDirectory: '/w' })
    expect(unit).toContain('ExecStart="/opt/my node/node" /srv/x/main.js')
    expect(unit).toContain('Environment="THEOCLAW_CONFIG=/c/a b.env"')
    expect(unit).toContain('Environment=THEOCLAW_PROFILE=a')
    expect(unit).toContain('Description=TheoClaw (theoclaw-a)')
  })
})
