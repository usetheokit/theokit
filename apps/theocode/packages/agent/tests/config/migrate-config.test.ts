/**
 * `theocode migrate-config` — the command the refusal names.
 *
 * An error message that names a command is a promise; the version of this refusal that shipped
 * before the command existed would have been a fabricated mechanism, which is the defect this
 * repository's rules single out by name. So the command exists, and these are its contracts.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { migrateConfigFile, findStrandedConfigs } from '../../src/config/migrate-config.js'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'theocode-migrate-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function toml(rel: string, body: string): string {
  mkdirSync(join(dir, rel), { recursive: true })
  const path = join(dir, rel, 'config.toml')
  writeFileSync(path, body)
  return path
}

describe('the conversion', () => {
  it('test_it_writes_a_settings_json_beside_the_file_it_converted', () => {
    const from = toml('.theokit', 'model = "openai/x"\nreasoning_effort = "high"\n')
    const to = migrateConfigFile(from)

    expect(to).toBe(join(dir, '.theokit', 'settings.json'))
    expect(JSON.parse(readFileSync(to, 'utf8'))).toEqual({
      model: 'openai/x',
      reasoning_effort: 'high',
    })
  })

  it('test_it_goes_through_the_same_schema_the_loader_uses', () => {
    // The point of routing the conversion through `configSchema` rather than through a hand-written
    // key map: a conversion that accepted what the loader rejects would produce a file that cannot
    // start the product, and the operator would meet the failure one command later.
    const from = toml('.theokit', 'model = "openai/x"\nnot_a_key = 1\n')
    expect(() => migrateConfigFile(from)).toThrow(/not_a_key/)
  })

  it('test_nested_tables_survive_the_round_trip', () => {
    const from = toml(
      '.theokit',
      '[profiles.fast]\nmodel = "openai/fast"\n\n[[hooks]]\nevent = "Stop"\ncommand = "c.sh"\n',
    )
    const written = JSON.parse(readFileSync(migrateConfigFile(from), 'utf8')) as Record<
      string,
      unknown
    >
    expect(written['profiles']).toEqual({ fast: { model: 'openai/fast' } })
    expect(written['hooks']).toEqual([{ event: 'Stop', command: 'c.sh' }])
  })

  it('test_it_refuses_to_overwrite_a_settings_json_that_is_already_there', () => {
    // Overwriting would destroy a migration the operator already did by hand, and the whole file is
    // their configuration. Refusing costs one `rm`; overwriting costs whatever they had written.
    const from = toml('.theokit', 'model = "openai/x"\n')
    writeFileSync(join(dir, '.theokit', 'settings.json'), '{"model":"openai/kept"}')

    expect(() => migrateConfigFile(from)).toThrow(/already exists/)
    expect(JSON.parse(readFileSync(join(dir, '.theokit', 'settings.json'), 'utf8'))).toEqual({
      model: 'openai/kept',
    })
  })

  it('test_it_leaves_the_original_in_place', () => {
    // Deleting it is the operator's call. A migration that removes the only copy of a file it just
    // transformed has no undo.
    const from = toml('.theokit', 'model = "openai/x"\n')
    migrateConfigFile(from)
    expect(readFileSync(from, 'utf8')).toContain('openai/x')
  })

  it('test_malformed_toml_names_the_file', () => {
    const from = toml('.theokit', 'model = = =\n')
    expect(() => migrateConfigFile(from)).toThrow(/config\.toml/)
  })
})

describe('finding what to convert', () => {
  it('test_it_reports_every_root_that_still_holds_one', () => {
    toml('.theokit', 'model = "openai/a"\n')
    toml('.theocode', 'model = "openai/b"\n')
    expect(findStrandedConfigs(dir)).toEqual([
      join(dir, '.theokit', 'config.toml'),
      join(dir, '.theocode', 'config.toml'),
    ])
  })

  it('test_a_directory_with_nothing_to_convert_reports_nothing', () => {
    // Negative control: without it, a finder that returned both paths unconditionally would pass.
    expect(findStrandedConfigs(dir)).toEqual([])
  })
})
