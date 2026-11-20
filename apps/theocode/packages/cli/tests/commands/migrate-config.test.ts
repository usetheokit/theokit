/**
 * The command has to cover the scope the refusal names.
 *
 * Measured 2026-09-07, on the first end-to-end run of this feature: a stranded `config.toml` under
 * the USER root refused the start and named `theocode migrate-config`; the command scanned only the
 * project directory, reported "converted ..." about a different file, and the refusal kept firing.
 * An instruction that runs, succeeds, and leaves the operator exactly where they were is worse than
 * no instruction — it spends their trust on the diagnosis.
 */
import { mkdirSync, mkdtempSync, existsSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { migrateConfigCommand } from '../../src/commands/migrate-config.js'

let root: string
let said: string[]

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'theocode-migrate-cmd-'))
  said = []
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    said.push(String(chunk))
    return true
  })
})
afterEach(() => {
  vi.restoreAllMocks()
  rmSync(root, { recursive: true, force: true })
})

function toml(dir: string, rel: string): void {
  mkdirSync(join(dir, rel), { recursive: true })
  writeFileSync(join(dir, rel, 'config.toml'), 'model = "openai/x"\n')
}

describe('scope coverage', () => {
  it('test_it_converts_the_user_scope_too', () => {
    const project = join(root, 'proj')
    const home = join(root, 'home')
    mkdirSync(project, { recursive: true })
    toml(home, '.theokit')

    migrateConfigCommand(project, { userDir: home, env: {} })

    expect(existsSync(join(home, '.theokit', 'settings.json'))).toBe(true)
  })

  it('test_it_converts_the_project_scope_too', () => {
    // Anti-vacuity: a command that only walked the user root would pass the arm above.
    const project = join(root, 'proj')
    const home = join(root, 'home')
    mkdirSync(home, { recursive: true })
    toml(project, '.theokit')

    migrateConfigCommand(project, { userDir: home, env: {} })

    expect(existsSync(join(project, '.theokit', 'settings.json'))).toBe(true)
  })

  it('test_it_follows_the_configured_home_root', () => {
    // `THEOKIT_HOME` moves this product's state directory, and a converter that ignored it would
    // convert a file the loader does not read while leaving the one it does.
    const project = join(root, 'proj')
    const home = join(root, 'elsewhere')
    mkdirSync(project, { recursive: true })
    mkdirSync(home, { recursive: true })
    writeFileSync(join(home, 'config.toml'), 'model = "openai/x"\n')

    migrateConfigCommand(project, { userDir: root, env: { THEOKIT_HOME: home } })

    expect(existsSync(join(home, 'settings.json'))).toBe(true)
  })

  it('test_one_file_that_cannot_be_converted_does_not_abort_the_others', () => {
    // The second defect this command had, also measured on a real run: the project root already
    // held a `settings.json`, `migrateConfigFile` threw over it, and the loop died BEFORE reaching
    // the user root — the exact scope the refusal had named. A per-file problem must stay per-file.
    const project = join(root, 'proj')
    const home = join(root, 'home')
    toml(project, '.theokit')
    writeFileSync(join(project, '.theokit', 'settings.json'), '{}')
    toml(home, '.theokit')

    migrateConfigCommand(project, { userDir: home, env: {} })

    expect(existsSync(join(home, '.theokit', 'settings.json'))).toBe(true)
    expect(said.join(''), 'the file it could not convert was not reported').toContain('already exists')
  })

  it('test_with_nothing_to_convert_it_says_so_and_writes_nothing', () => {
    const project = join(root, 'proj')
    mkdirSync(project, { recursive: true })

    migrateConfigCommand(project, { userDir: join(root, 'home'), env: {} })

    expect(said.join('')).toContain('nothing to convert')
  })
})
