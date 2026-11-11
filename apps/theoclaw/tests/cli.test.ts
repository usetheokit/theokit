import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { type CliIo, runCli } from '../src/cli.js'
import type { Runner } from '../src/run-command.js'
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

  it('--version prints the package version and exits 0', async () => {
    const v = harness()
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')) as { version: string }
    expect(await runCli(['--version'], v.io)).toBe(0)
    expect(v.stdout()).toBe(`${pkg.version}\n`)
    expect(v.stderr()).toBe('')
  })

  it('dispatches sandbox: bwrap has nothing to manage, a bad verb is a usage error', async () => {
    const ok = harness()
    expect(await runCli(['sandbox', 'list'], ok.io)).toBe(0)
    expect(ok.stdout()).toContain('nothing to manage')
    const bad = harness()
    expect(await runCli(['sandbox', 'nope'], bad.io)).toBe(2)
  })

  it('help names start, onboard and help, and an undefined one exits 2', async () => {
    const help = harness()
    expect(await runCli(['--help'], help.io)).toBe(0)
    for (const name of ['start', 'onboard', 'sandbox list', '--help']) expect(help.stdout()).toContain(name)
    expect(help.stderr()).toBe('')

    const unknown = harness()
    expect(await runCli(['frobnicate'], unknown.io)).toBe(2)
    expect(unknown.stderr()).toContain('theoclaw start')
    expect(unknown.stdout()).toBe('')

    const none = harness()
    expect(await runCli([], none.io)).toBe(2)
  })

  it('help_names_the_three_daemon_backends', async () => {
    const help = harness()
    expect(await runCli(['--help'], help.io)).toBe(0)
    for (const name of ['systemd', 'launchd', 'Task Scheduler', 'theoclaw start [--config <path>] [--profile <name>]']) {
      expect(help.stdout()).toContain(name)
    }
  })

  it('help names the six subcommands and an undefined one exits 2', async () => {
    const help = harness()
    expect(await runCli(['--help'], help.io)).toBe(0)
    for (const name of ['theoclaw start', 'theoclaw onboard', 'theoclaw daemon install', 'theoclaw daemon uninstall', 'theoclaw daemon status', 'theoclaw update', 'theoclaw backup <dir>', 'theoclaw restore <dir>']) {
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

  it('acp runs the ACP entry beside the main entry with the arguments given', async () => {
    const dir = scratchDir()
    const out = join(dir, 'acp.out')
    writeFileSync(join(dir, 'main-acp.js'), `import { writeFileSync } from 'node:fs'\nwriteFileSync(${JSON.stringify(out)}, process.argv.slice(2).join(' '))\n`)
    writeFileSync(join(dir, 'package.json'), '{"type":"module"}')
    const h = harness(join(dir, 'main.js'))

    expect(await runCli(['acp', '--profile', 'zed'], h.io)).toBe(0)
    expect(readFileSync(out, 'utf8')).toBe('--profile zed')
    const help = harness()
    await runCli(['--help'], help.io)
    expect(help.stdout()).toContain('theoclaw acp')
  })

  it('import runs the import entry beside the main entry as --from <kind>, and refuses another kind', async () => {
    const dir = scratchDir()
    const out = join(dir, 'import.out')
    writeFileSync(join(dir, 'import-main.js'), `import { writeFileSync } from 'node:fs'\nwriteFileSync(${JSON.stringify(out)}, process.argv.slice(2).join(' '))\n`)
    writeFileSync(join(dir, 'package.json'), '{"type":"module"}')
    const h = harness(join(dir, 'main.js'))

    expect(await runCli(['import', 'claude-code', '--dry-run'], h.io)).toBe(0)
    expect(readFileSync(out, 'utf8')).toBe('--from claude-code --dry-run')
    expect(await runCli(['import', 'openclaw'], harness().io)).toBe(2)
    const help = harness()
    await runCli(['--help'], help.io)
    expect(help.stdout()).toContain('theoclaw import')
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

  it('backup and restore move an instance and exit 0, and a refusal exits 1 naming it', async () => {
    const dir = scratchDir()
    const env = { THEOCLAW_STATE_DIR: join(dir, 'state'), THEOCLAW_WORKSPACE: join(dir, 'workspace') }
    mkdirSync(env.THEOCLAW_STATE_DIR)
    mkdirSync(env.THEOCLAW_WORKSPACE)
    writeFileSync(join(env.THEOCLAW_WORKSPACE, 'note.txt'), 'hello')
    const backup = harness()
    expect(await runCli(['backup', join(dir, 'b')], { ...backup.io, env: { ...backup.io.env, ...env } })).toBe(0)
    expect(backup.stdout()).toContain('backed up 1 files')

    const target = { THEOCLAW_STATE_DIR: join(dir, 'restored-state'), THEOCLAW_WORKSPACE: join(dir, 'restored-workspace') }
    const restore = harness()
    expect(await runCli(['restore', join(dir, 'b')], { ...restore.io, env: { ...restore.io.env, ...target } })).toBe(0)
    expect(readFileSync(join(target.THEOCLAW_WORKSPACE, 'note.txt'), 'utf8')).toBe('hello')

    const again = harness()
    expect(await runCli(['restore', join(dir, 'b')], { ...again.io, env: { ...again.io.env, ...target } })).toBe(1)
    expect(again.stderr()).toMatch(/^theoclaw: .*is not empty/m)
    expect(await runCli(['backup'], harness().io)).toBe(2)
  })
})
