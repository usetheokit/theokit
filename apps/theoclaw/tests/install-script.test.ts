import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

/**
 * `install.sh` (B-374, T2.2) run in a scratch checkout with `PATH` restricted to recording stubs of
 * `node`, `git`, `corepack` and `pnpm` plus the few system tools a shell script needs, so nothing
 * touches the network or the real checkout. The clean-machine run is the container check (T5.2).
 */
const APP_DIR = fileURLToPath(new URL('..', import.meta.url))
const INSTALL = join(APP_DIR, 'install.sh')
const README = join(APP_DIR, 'README.md')
const SYSTEM_TOOLS = ['bash', 'sh', 'dirname', 'mkdir', 'chmod', 'mv', 'cat', 'rm', 'env']

const scratch: string[] = []

afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true })
})

type Stub = 'node' | 'git' | 'corepack' | 'pnpm'

interface Machine {
  readonly root: string
  readonly checkout: string
  readonly home: string
  readonly binDir: string
  readonly shimDir: string
  readonly records: string
  readonly path: string
}

const RECORD = 'printf "%s\\n" "$@" >> "$RECORD_DIR/$(basename "$0").args"; echo --- >> "$RECORD_DIR/$(basename "$0").args"'

const STUBS: Readonly<Record<Stub, string>> = {
  node: [
    '#!/bin/sh',
    'case "$1" in',
    '  -p) echo "${STUB_NODE_MAJOR:-22}" ;;',
    '  --version) echo "v${STUB_NODE_MAJOR:-22}.0.0" ;;',
    `  *) ${RECORD}; echo "$PATH" > "$RECORD_DIR/node.path"; /usr/bin/mkdir -p apps/theoclaw/dist; echo '#!/usr/bin/env node' > apps/theoclaw/dist/cli.js ;;`,
    'esac',
  ].join('\n'),
  git: ['#!/bin/sh', RECORD, 'case "$*" in *"rev-parse HEAD"*) echo "${STUB_GIT_SHA:-0000000000000000000000000000000000000000}" ;; esac'].join('\n'),
  pnpm: ['#!/bin/sh', RECORD, 'exit "${STUB_PNPM_EXIT:-0}"'].join('\n'),
  // `enable --install-directory <dir> pnpm` writes a recording pnpm into <dir>, as corepack does.
  corepack: [
    '#!/bin/sh',
    RECORD,
    'if [ "$1" = enable ] && [ "$2" = --install-directory ]; then',
    `  printf '%s\\n' '#!/bin/sh' '${RECORD}' > "$3/pnpm"`,
    '  /usr/bin/chmod +x "$3/pnpm"',
    'fi',
  ].join('\n'),
}

function machine(stubs: readonly Stub[]): Machine {
  const root = mkdtempSync(join(tmpdir(), 'theoclaw-install-'))
  scratch.push(root)
  const checkout = join(root, 'theokit')
  mkdirSync(join(checkout, 'apps', 'theoclaw'), { recursive: true })
  copyFileSync(INSTALL, join(checkout, 'apps', 'theoclaw', 'install.sh'))
  const bin = join(root, 'stubs')
  mkdirSync(bin)
  for (const tool of SYSTEM_TOOLS) symlinkSync(`/usr/bin/${tool}`, join(bin, tool))
  symlinkSync('/usr/bin/basename', join(bin, 'basename'))
  for (const stub of stubs) writeFileSync(join(bin, stub), `${STUBS[stub]}\n`, { mode: 0o755 })
  const home = join(root, 'home')
  const records = join(root, 'records')
  mkdirSync(home)
  mkdirSync(records)
  return {
    root,
    checkout,
    home,
    binDir: join(home, '.local', 'bin'),
    shimDir: join(root, 'data', 'theoclaw', 'bin'),
    records,
    path: bin,
  }
}

function install(m: Machine, env: Record<string, string> = {}): { status: number | null; stderr: string; stdout: string } {
  const result = spawnSync('/usr/bin/bash', [join(m.checkout, 'apps', 'theoclaw', 'install.sh')], {
    cwd: m.root,
    env: { PATH: m.path, HOME: m.home, XDG_DATA_HOME: join(m.root, 'data'), RECORD_DIR: m.records, ...env },
    encoding: 'utf8',
  })
  return { status: result.status, stderr: result.stderr, stdout: result.stdout }
}

/** Each call's argv, in order, for one stub. */
function calls(m: Machine, stub: Stub): string[][] {
  const file = join(m.records, `${stub}.args`)
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8')
    .split('---\n')
    .filter((block) => block !== '')
    .map((block) => block.split('\n').filter((line) => line !== ''))
}

function launcher(m: Machine): string {
  return join(m.binDir, 'theoclaw')
}

describe('install.sh', () => {
  it('install refuses without node 22 or git and names the tool', () => {
    const noGit = machine(['node', 'pnpm'])
    const refusedGit = install(noGit)
    expect(refusedGit.status).toBe(1)
    expect(refusedGit.stderr).toMatch(/^theoclaw install: git .*required/m)
    expect(existsSync(launcher(noGit))).toBe(false)

    const oldNode = machine(['node', 'git', 'pnpm'])
    const refusedNode = install(oldNode, { STUB_NODE_MAJOR: '20' })
    expect(refusedNode.status).toBe(1)
    expect(refusedNode.stderr).toMatch(/^theoclaw install: node 22 .*required/m)
    expect(existsSync(launcher(oldNode))).toBe(false)
    expect(calls(oldNode, 'pnpm')).toEqual([])
  })

  it('install runs the filtered install and build, then writes one launcher, twice', () => {
    const m = machine(['node', 'git', 'pnpm'])
    for (let run = 0; run < 2; run += 1) {
      const result = install(m)
      expect(result.status, result.stderr).toBe(0)
    }
    expect(calls(m, 'pnpm')).toEqual([
      ['install', '--frozen-lockfile', '--filter', 'theoclaw...'],
      ['install', '--frozen-lockfile', '--filter', 'theoclaw...'],
    ])
    expect(calls(m, 'node').filter((argv) => argv[0] === 'scripts/live-model-build.mjs')).toEqual([
      ['scripts/live-model-build.mjs', 'theoclaw'],
      ['scripts/live-model-build.mjs', 'theoclaw'],
    ])
    expect(readFileSync(launcher(m), 'utf8')).toBe(
      `#!/bin/sh\nexec node "${join(m.checkout, 'apps', 'theoclaw', 'dist', 'cli.js')}" "$@"\n`,
    )
    expect(statSync(launcher(m)).mode & 0o777).toBe(0o755)
    expect(readdirSync(m.binDir)).toEqual(['theoclaw'])
  })

  it('install stops when the package install fails and writes no launcher', () => {
    const m = machine(['node', 'git', 'pnpm'])
    const result = install(m, { STUB_PNPM_EXIT: '1' })
    expect(result.status).not.toBe(0)
    expect(existsSync(launcher(m))).toBe(false)
  })

  it('the documented install command is the first block of the Install section', () => {
    const readme = readFileSync(README, 'utf8')
    const section = readme.split(/^## /m).find((part) => part.startsWith('Install\n'))
    expect(section, 'README.md has a "## Install" section').toBeDefined()
    const block = /```bash\n([\s\S]*?)```/.exec(section!)
    expect(block?.[1].trim()).toBe(
      'git clone https://github.com/usetheokit/theokit.git theokit && theokit/apps/theoclaw/install.sh',
    )
  })

  it('install puts a user-owned package-manager shim on PATH when none is installed', () => {
    const m = machine(['node', 'git', 'corepack'])
    const result = install(m)
    expect(result.status, result.stderr).toBe(0)
    expect(calls(m, 'corepack')).toEqual([['enable', '--install-directory', m.shimDir, 'pnpm']])
    expect(m.shimDir.startsWith(join(m.root, 'data'))).toBe(true)
    expect(calls(m, 'pnpm')[0]?.[0]).toBe('install')
    expect(readFileSync(join(m.records, 'node.path'), 'utf8').startsWith(`${m.shimDir}:`)).toBe(true)
  })

  it('install leaves an installed package manager untouched', () => {
    const m = machine(['node', 'git', 'corepack', 'pnpm'])
    expect(install(m).status).toBe(0)
    expect(calls(m, 'corepack')).toEqual([])
  })

  it('install creates a missing bin directory', () => {
    const m = machine(['node', 'git', 'pnpm'])
    const binDir = join(m.root, 'nested', 'missing', 'bin')
    const result = install(m, { THEOCLAW_BIN_DIR: binDir })
    expect(result.status, result.stderr).toBe(0)
    expect(existsSync(join(binDir, 'theoclaw'))).toBe(true)
    expect(result.stdout).toContain(`${binDir} is not on PATH`)
  })

  it('install writes the installed commit only after the build and the launcher succeed', () => {
    const sha = 'abcdef0123456789abcdef0123456789abcdef01'
    const m = machine(['node', 'git', 'pnpm'])
    const marker = join(m.checkout, 'apps', 'theoclaw', 'dist', '.installed-commit')
    expect(install(m, { STUB_GIT_SHA: sha }).status).toBe(0)
    expect(readFileSync(marker, 'utf8').trim()).toBe(sha)

    const failing = machine(['node', 'git', 'pnpm'])
    const failedMarker = join(failing.checkout, 'apps', 'theoclaw', 'dist', '.installed-commit')
    expect(install(failing, { STUB_GIT_SHA: sha, STUB_PNPM_EXIT: '1' }).status).toBe(1)
    expect(existsSync(failedMarker)).toBe(false)
  })
})
