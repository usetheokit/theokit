import { cpSync, mkdirSync, readdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { type ForeignSetup, readForeignSetup } from '@theokit/agents/foreign-setup'

/**
 * The checked-in migration samples (FR-012). Their dot-entries are stored as `dot-…` (plan D2), so
 * nothing under this repository is a `.claude/` path; {@link copyFixture} copies a sample into a
 * temporary directory and gives each entry its real name, so no test reads or writes the tree.
 */
export const FIXTURES = fileURLToPath(new URL('./fixtures/migration', import.meta.url))

/** Every value of an MCP `env` or `headers` entry in the samples, which no output may hold (NFR-003). */
export const FIXTURE_SECRETS = [
  'fixture-secret-db-token',
  'Bearer fixture-secret-search-header',
  'fixture-secret-hermes-token',
  'Bearer fixture-secret-hermes-header',
] as const

function renameDotEntries(dir: string): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const name = entry.name.startsWith('dot-') ? `.${entry.name.slice('dot-'.length)}` : entry.name
    if (name !== entry.name) renameSync(join(dir, entry.name), join(dir, name))
    if (entry.isDirectory()) renameDotEntries(join(dir, name))
  }
}

/** Copy the sample `name` (`claude-code` or `hermes`) into `into`, renaming its `dot-` entries. */
export function copyFixture(name: 'claude-code' | 'hermes', into: string): string {
  mkdirSync(into, { recursive: true })
  cpSync(join(FIXTURES, name), into, { recursive: true })
  renameDotEntries(into)
  return into
}

/** The shared reader, called as the migration tests name their two sources. */
export function readClaudeCodeSetup(input: { configDir?: string; home: string; project?: string }): ForeignSetup {
  return readForeignSetup('claude-code', {
    home: input.home,
    ...(input.configDir === undefined ? {} : { configDir: input.configDir }),
    ...(input.project === undefined ? {} : { cwd: input.project }),
  })
}

export function readHermesSetup(input: { root: string }): ForeignSetup {
  return readForeignSetup('hermes', { home: input.root, configDir: input.root })
}
