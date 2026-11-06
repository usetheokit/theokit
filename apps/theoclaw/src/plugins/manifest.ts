import { parse } from 'yaml'

/** What a plugin's `PLUGIN.md` frontmatter says: the manifest the SDK reads and TheoClaw checks first. */
export interface PluginManifest {
  readonly name: string
  readonly version: string
  /** The module (relative to the plugin folder) whose default export is the plugin. */
  readonly entry: string
}

const NAME = /^[a-z0-9][a-z0-9-]{0,63}$/
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---/

/** Parse a `PLUGIN.md`; throws an Error naming the first thing wrong with it. */
export function parsePluginManifest(text: string): PluginManifest {
  const match = FRONTMATTER.exec(text)
  if (match === null) throw new Error('PLUGIN.md has no frontmatter')
  const data: unknown = parse(match[1] ?? '')
  if (typeof data !== 'object' || data === null) throw new Error('PLUGIN.md frontmatter is not a mapping')
  const record = data as Record<string, unknown>
  const { name, version, entry } = record
  if (typeof name !== 'string' || !NAME.test(name)) throw new Error('PLUGIN.md needs a name of lowercase letters, digits and dashes')
  if (typeof entry !== 'string' || entry === '') throw new Error('PLUGIN.md needs an entry')
  if (entry.startsWith('/') || /^[a-zA-Z]:/.test(entry) || entry.split(/[\\/]/).includes('..')) {
    throw new Error('PLUGIN.md entry must stay inside the plugin folder')
  }
  return { name, version: typeof version === 'string' ? version : '0.0.0', entry }
}
