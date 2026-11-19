import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The skill folders the SDK reads once the `project` setting source is on: the project config roots
 * (`.theokit`, and `.claude` when `.theokit/config.json` lists the `claude-code` compat adapter for the
 * surface), then each plugin bundle's `skills` under the roots that admit `plugins`. The SDK keeps this
 * private, so it is mirrored here, from the same config file, to let TheoClaw gate and read what the SDK offers.
 */
type CompatSource = string | { kind?: string; import?: string[] }

function compatSources(cwd: string): CompatSource[] {
  try {
    const parsed = JSON.parse(readFileSync(join(cwd, '.theokit', 'config.json'), 'utf8')) as { compat?: { adapters?: unknown } }
    return Array.isArray(parsed.compat?.adapters) ? (parsed.compat.adapters as CompatSource[]) : []
  } catch {
    return []
  }
}

const kindOf = (source: CompatSource): string | undefined => (typeof source === 'string' ? source : source.kind)
const admits = (source: CompatSource, surface: string): boolean => typeof source === 'string' || (source.import ?? []).includes(surface)

function configRoots(cwd: string, sources: CompatSource[], surface: string): string[] {
  const native = sources.filter((source) => kindOf(source) === 'theokit')
  const own = native.length === 0 || native.some((source) => admits(source, surface)) ? [join(cwd, '.theokit')] : []
  const claude = sources.some((source) => kindOf(source) === 'claude-code' && admits(source, surface)) ? [join(cwd, '.claude')] : []
  return [...own, ...claude]
}

/** Project skill folders, then plugin skill folders, in the order the SDK searches them. */
export function projectSkillRoots(cwd: string): string[] {
  const sources = compatSources(cwd)
  const bundles: string[] = []
  for (const root of configRoots(cwd, sources, 'plugins')) {
    const plugins = join(root, 'plugins')
    try {
      for (const entry of readdirSync(plugins, { withFileTypes: true })) if (entry.isDirectory()) bundles.push(join(plugins, entry.name, 'skills'))
    } catch {
      // No plugins folder here.
    }
  }
  return [...configRoots(cwd, sources, 'skills').map((root) => join(root, 'skills')), ...bundles]
}
