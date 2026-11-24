/* eslint-disable sonarjs/no-os-command-from-path -- the test drives the docker CLI */
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  mkdirSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { scaffold } from '../../src/index.js'

const HOST_DIR = resolve(fileURLToPath(new URL('../../../host', import.meta.url)))
const hostBuilt = existsSync(join(HOST_DIR, 'dist/app-host/index.js'))
const dockerUp = spawnSync('docker', ['info'], { stdio: 'ignore' }).status === 0

describe('--preset=daemon scaffold', () => {
  let root: string
  let dir: string
  let env: NodeJS.ProcessEnv

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'ctk-daemon-'))
    dir = join(root, 'my-daemon')
    scaffold(dir, 'my-daemon', 'default', { daemonPreset: true })
    mkdirSync(join(dir, 'node_modules/@theokit'), { recursive: true })
    symlinkSync(HOST_DIR, join(dir, 'node_modules/@theokit/host'))
    env = {
      PATH: process.env.PATH,
      HOME: join(root, 'home'),
      MY_DAEMON_CONFIG: join(root, 'cfg', 'my-daemon.env'),
      MY_DAEMON_STATE_DIR: join(root, 'state'),
    }
  })
  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('ships the host entry, Dockerfile and ignore files', () => {
    for (const f of [
      'main.mjs',
      'app.mjs',
      'Dockerfile',
      'README.md',
      '.gitignore',
      '.dockerignore',
    ])
      expect(existsSync(join(dir, f))).toBe(true)
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8')) as {
      name: string
      dependencies: Record<string, string>
    }
    expect(pkg.name).toBe('my-daemon')
    expect(pkg.dependencies['@theokit/host']).toBeDefined()
    expect(readFileSync(join(dir, 'main.mjs'), 'utf-8')).toContain('createAppHost')
  })

  it('delegates the daemon verbs to the shared commands and accepts task entry arguments', () => {
    const main = readFileSync(join(dir, 'main.mjs'), 'utf-8')
    expect(main).toContain('daemonCommands')
    expect(main).toContain('entryArgs')
    expect(main).toContain('applyEntryArgs')
    expect(main).not.toContain('backend.install')
  })

  it.skipIf(!hostBuilt)(
    'onboard --yes writes the config; the entry stops cleanly on SIGTERM',
    async () => {
      execFileSync(process.execPath, ['main.mjs', 'onboard', '--yes'], { cwd: dir, env })
      expect(readFileSync(env.MY_DAEMON_CONFIG!, 'utf-8')).toContain('MY_DAEMON_MODEL=')

      const child = spawn(process.execPath, ['main.mjs'], {
        cwd: dir,
        env,
        stdio: ['ignore', 'pipe', 'inherit'],
      })
      await new Promise<void>((ok, fail) => {
        child.once('error', fail)
        child.once('exit', () => fail(new Error('exited before it started')))
        child.stdout.on('data', (d: Buffer) => {
          if (d.toString().includes('started')) ok()
        })
      })
      const exited = new Promise<number | null>((ok) => child.once('exit', (code) => ok(code)))
      child.kill('SIGTERM')
      expect(await exited).toBe(0)
      expect(existsSync(join(root, 'state', 'started.json'))).toBe(true)
    },
  )

  it('refuses to combine with other templates', () => {
    expect(() =>
      scaffold(join(root, 'x'), 'x', 'default', { daemonPreset: true, bare: true }),
    ).toThrow(/standalone/)
  })

  it.skipIf(!dockerUp || !hostBuilt)(
    'the image keeps config and state on the /data volume',
    () => {
      const tag = `ctk-daemon-test:${String(process.pid)}`
      const volume = `ctk-daemon-vol-${String(process.pid)}`
      const docker = (...a: string[]): string => execFileSync('docker', a, { encoding: 'utf-8' })
      // The template names a host version this release publishes; pack the workspace host and
      // install that tarball in the image instead of asking the registry for it.
      const packDir = mkdtempSync(join(root, 'pack-'))
      execFileSync('pnpm', ['pack', '--pack-destination', packDir], { cwd: HOST_DIR })
      const tgz = readdirSync(packDir).find((f) => f.endsWith('.tgz'))!
      renameSync(join(packDir, tgz), join(dir, 'theokit-host.tgz'))
      const pkgPath = join(dir, 'package.json')
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as {
        dependencies: Record<string, string>
      }
      pkg.dependencies['@theokit/host'] = 'file:./theokit-host.tgz'
      writeFileSync(pkgPath, JSON.stringify(pkg, null, 2))
      const dockerfile = join(dir, 'Dockerfile')
      const original = readFileSync(dockerfile, 'utf-8')
      const adapted = original
        .replace('COPY package.json ./', 'COPY package.json theokit-host.tgz ./')
        .replace('RUN npm install', 'RUN npm install --legacy-peer-deps')
      expect(adapted).not.toBe(original)
      writeFileSync(dockerfile, adapted)
      try {
        docker('build', '-t', tag, dir)
        expect(
          docker(
            'run',
            '--rm',
            '--entrypoint',
            'cat',
            tag,
            'node_modules/@theokit/host/package.json',
          ),
        ).toContain(
          `"version": "${(JSON.parse(readFileSync(join(HOST_DIR, 'package.json'), 'utf-8')) as { version: string }).version}"`,
        )
        docker('run', '--rm', '-v', `${volume}:/data`, tag, 'onboard', '--yes')
        const id = docker('run', '-d', '-v', `${volume}:/data`, tag).trim()
        try {
          for (let i = 0; i < 30 && !docker('logs', id).includes('started'); i++)
            execFileSync('sleep', ['0.5'])
          expect(docker('exec', id, 'id', '-u').trim()).not.toBe('0')
          expect(docker('exec', id, 'ls', '/data/config', '/data/state')).toMatch(
            /my-daemon\.env[\s\S]*started\.json/,
          )
          docker('stop', '-t', '10', id)
          expect(docker('inspect', '-f', '{{.State.ExitCode}}', id).trim()).toBe('0')
        } finally {
          spawnSync('docker', ['rm', '-f', id])
        }
      } finally {
        spawnSync('docker', ['volume', 'rm', '-f', volume])
        spawnSync('docker', ['rmi', '-f', tag])
      }
    },
    300_000,
  )
})
