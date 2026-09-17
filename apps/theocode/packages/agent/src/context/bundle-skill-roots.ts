import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { DEFAULT_HOME_DIR } from '../config/home-dir.js'

/** The config roots that may nest bundles — the same two `skills-on-disk.ts` walks. */
const ROOTS = [DEFAULT_HOME_DIR, '.claude'] as const

/**
 * Every `skills/` directory a plugin bundle contributes, under either config root.
 *
 * #826 — one level of nesting, deliberately: `<root>/plugins/<bundle>/skills/<name>/SKILL.md` is the
 * shape this product already recognises in `skills-on-disk.ts`, and walking deeper would start
 * offering the model files nothing has evidence are meant to be loaded.
 *
 * Returns DIRECTORIES rather than names, because the caller hands each to `discoverSkills`. That is
 * also why this is not a second reader of the SKILL.md convention: the discovery and the parsing stay
 * the SDK's, and only the list of places to look grows.
 *
 * An absent root, an absent `plugins/` and an unreadable one all yield nothing. None of the three is
 * an error — a project with no bundles is the ordinary case.
 */
export function bundleSkillRoots(cwd: string): string[] {
  return ROOTS.flatMap((root) => bundlesIn(join(cwd, root, 'plugins')))
}

function bundlesIn(pluginsDir: string): string[] {
  if (!existsSync(pluginsDir)) return []
  try {
    return readdirSync(pluginsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => join(pluginsDir, e.name, 'skills'))
  } catch {
    return []
  }
}
