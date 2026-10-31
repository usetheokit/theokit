import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { type CliIo, runCli } from '../src/cli.js'
import type { Runner } from '../src/daemon.js'
import { loadConfiguration } from '../src/config-file.js'
import { cleanScratch, harness, processGroup, scratchDir, stubEntry, waitForLog } from './support/cli-harness.js'

afterEach(cleanScratch)

describe('the theoclaw command line', () => {
  it('start loads the configuration file without overwriting the environment', () => {
    const dir = scratchDir()
    const path = join(dir, 'theoclaw.env')
    const unset = `THEOCLAW_CLI_TEST_${process.pid}`
    writeFileSync(path, `THEOCLAW_MODEL="from-file"\n${unset}="loaded"\n`)
    const env: NodeJS.ProcessEnv = { THEOCLAW_CONFIG: path, THEOCLAW_MODEL: 'from-env' }

    loadConfiguration(env, dir)

    expect(env.THEOCLAW_MODEL).toBe('from-env')
    expect(env[unset]).toBe('loaded')
    expect(process.env[unset]).toBeUndefined()
  })

  it('help names start, onboard and help, and an undefined one exits 2', async () => {
    const help = harness()
    expect(await runCli(['--help'], help.io)).toBe(0)
    for (const name of ['start', 'onboard', '--help']) expect(help.stdout()).toContain(name)
    expect(help.stderr()).toBe('')

    const unknown = harness()
    expect(await runCli(['frobnicate'], unknown.io)).toBe(2)
    expect(unknown.stderr()).toContain('theoclaw start')
    expect(unknown.stdout()).toBe('')

    const none = harness()
    expect(await runCli([], none.io)).toBe(2)
  })

  it('help names the six subcommands and an undefined one exits 2', async () => {
    const help = harness()
    expect(await runCli(['--help'], help.io)).toBe(0)
    for (const name of ['theoclaw start', 'theoclaw onboard', 'theoclaw daemon install', 'theoclaw daemon uninstall', 'theoclaw daemon status', 'theoclaw update']) {
      expect(help.stdout()).toContain(name)
    }
    const unknown = harness()
    expect(await runCli(['upgrade'], unknown.io)).toBe(2)
    expect(await runCli(['update', '--channel'], unknown.io)).toBe(2)
  })

  it('a refused subcommand prints its message and exits 1', async () => {
    const h = harness()
    expect(await runCli(['onboard'], h.io)).toBe(1)
    expect(h.stderr()).toMatch(/^theoclaw: .*--yes/m)

    const badFlag = harness()
    expect(await runCli(['onboard', '--no-such-flag'], badFlag.io)).toBe(2)
  })

  it('start runs the built entry and forwards SIGTERM', { timeout: 20_000 }, async () => {
    const { h, log } = stubEntry()
    const done = runCli(['start', log], h.io)
    await waitForLog(log, /^ready /m)
    h.signals.emit('SIGTERM', 'SIGTERM')

    expect(await done).toBe(0)
    expect(readFileSync(log, 'utf8')).toMatch(/^SIGTERM$/m)
  })

  // Audit finding (post-GREEN): the entry runs in its own session, so a closed terminal reaches only
  // this command; it must pass the hangup on rather than orphan an entry that holds the port.
  it('a terminal hangup is forwarded to the entry', { timeout: 20_000 }, async () => {
    const { h, log } = stubEntry()
    const done = runCli(['start', log], h.io)
    await waitForLog(log, /^ready /m)
    h.signals.emit('SIGHUP', 'SIGHUP')

    expect(await done).toBe(0)
    expect(readFileSync(log, 'utf8')).toMatch(/^SIGHUP$/m)
  })

  it('a terminal interrupt stops the entry once', { timeout: 20_000 }, async () => {
    const { h, log } = stubEntry()
    const done = runCli(['start', log], h.io)
    const [, childGroup] = (await waitForLog(log, /^ready (\d+)$/m))
    // The entry runs in its own process group, so a terminal's SIGINT, sent to the foreground
    // group, reaches only this command, which forwards it once.
    expect(childGroup).not.toBe(processGroup(process.pid))
    h.signals.emit('SIGINT', 'SIGINT')

    expect(await done).toBe(0)
    expect(readFileSync(log, 'utf8').match(/^shutdown/gm)).toHaveLength(1)
  })
})

describe('theoclaw daemon on the command line', () => {
  it('daemon dispatches install, uninstall and status', async () => {
    const seen: string[] = []
    const runner: Runner = (command, args) => {
      seen.push([command, ...args].join(' '))
      return Promise.resolve({ code: 0, stdout: command === 'systemctl' && args.includes('is-active') ? 'active\n' : '', stderr: '' })
    }
    const h = harness()
    const io: CliIo = { ...h.io, runner }
    // No configuration file in the scratch home, so install refuses before systemctl runs.
    expect(await runCli(['daemon', 'install'], io)).toBe(1)
    expect(h.stderr()).toContain('theoclaw onboard')
    expect(await runCli(['daemon', 'status'], io)).toBe(0)
    expect(await runCli(['daemon', 'uninstall'], io)).toBe(0)
    expect(seen).toContain('systemctl --user is-active theoclaw.service')
    expect(seen).toContain('systemctl --user daemon-reload')
    expect(await runCli(['daemon', 'restart-everything'], io)).toBe(2)
    expect(await runCli(['daemon'], io)).toBe(2)
  })
})

