/**
 * `create-theokit` scaffold tool. All write paths are derived from the
 * user-supplied target directory (CLI argument, resolved to absolute).
 * Read paths are the bundled `templates/` shipped with this package.
 * Build-time tool — no HTTP input.
 */
import {
  existsSync,
  cpSync,
  readFileSync,
  renameSync,
  unlinkSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs'
import { resolve, join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { applyBareTransform } from './bare-transform.js'
import { applyBotPreset } from './bot-preset.js'
import { writeScaffoldFile } from './write-file.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

function getTemplateDir(templateName = 'default'): string {
  return resolve(__dirname, '../templates', templateName)
}

function isValidProjectName(name: string): boolean {
  return /^[a-z0-9][a-z0-9._-]*$/.test(name)
}

interface ScaffoldOptions {
  bare?: boolean
  /** `--preset=bot`: layer the unattended-agent shape over the default template (#467). */
  botPreset?: boolean
  /** Test-only — force the bare transform to throw to validate EC-4 rollback. */
  _testForceTransformError?: string
}

export function scaffold(
  targetDir: string,
  projectName: string,
  templateName = 'default',
  options: ScaffoldOptions = {},
): void {
  // EC-4 + ADR D5: --bare only applies to default template
  if (options.bare && templateName !== 'default') {
    throw new Error(
      `--bare flag only applies to the default template; got "${templateName}". ` +
        `Use \`npx create-theokit <name> --template=default --bare\` or pick a different template.`,
    )
  }

  const templateDir = getTemplateDir(templateName)

  if (!existsSync(templateDir)) {
    throw new Error(`Template "${templateName}" not found. Available templates: default`)
  }

  // Bug #1 fix: "." means current directory — use dir basename as project name
  const resolvedName =
    projectName === '.' ? (resolve(targetDir).split('/').pop() ?? 'my-app') : projectName

  if (!isValidProjectName(resolvedName)) {
    throw new Error(
      `Invalid project name "${resolvedName}". ` +
        `Use lowercase letters, numbers, hyphens, and dots. Must start with a letter or number.`,
    )
  }

  if (existsSync(targetDir)) {
    const contents = readdirSync(targetDir)
    if (contents.length > 0) {
      throw new Error(`Directory "${targetDir}" is not empty. Please use an empty directory.`)
    }
  }

  cpSync(templateDir, targetDir, { recursive: true })

  // npm strips a leading dot from files in a published package, so the template ships them
  // prefixed and the scaffold restores the name.
  for (const [from, to] of [
    ['_gitignore', '.gitignore'],
    ['_prettierignore', '.prettierignore'],
  ]) {
    const src = join(targetDir, from)
    if (existsSync(src)) {
      renameSync(src, join(targetDir, to))
    }
  }

  // dot-claude/ → .claude/ (npm ignores dotfolders in published packages)
  const dotClaudeSrc = join(targetDir, 'dot-claude')
  const dotClaudeDest = join(targetDir, '.claude')
  if (existsSync(dotClaudeSrc)) {
    renameSync(dotClaudeSrc, dotClaudeDest)
  }

  // Apply {{name}} substitution to every `*.tmpl` file in the target dir.
  // Each `foo.tmpl` becomes `foo` with placeholders replaced. Walks only
  // the project root (deeper subfolders don't currently need templating).
  for (const entry of readdirSync(targetDir)) {
    if (!entry.endsWith('.tmpl')) continue
    const src = join(targetDir, entry)
    const stat = statSync(src)
    if (!stat.isFile()) continue
    const dst = join(targetDir, entry.slice(0, -'.tmpl'.length))
    const content = readFileSync(src, 'utf-8')
    const replaced = content.replace(/\{\{name\}\}/g, resolvedName)
    writeScaffoldFile(dst, replaced)
    unlinkSync(src)
  }

  // T4.1 — Apply --bare transform with EC-4 atomic rollback
  if (options.bare) {
    try {
      applyBareTransform(targetDir, {
        _testForceError: options._testForceTransformError,
      })
    } catch (err) {
      // EC-4: roll back partial state
      rmSync(targetDir, { recursive: true, force: true })
      const original = err instanceof Error ? err.message : String(err)
      throw new Error(
        `Scaffold rolled back: bare transform failed. Check filesystem perms.\nOriginal error: ${original}`,
      )
    }
  }

  // #467 — `--preset=bot` layers over the default template rather than being a second one. Same
  // rollback discipline as `--bare`: a partial layer leaves an app importing files it does not have,
  // which fails at build time three steps from the cause.
  if (options.botPreset) {
    try {
      applyBotPreset({ targetDir })
    } catch (err) {
      rmSync(targetDir, { recursive: true, force: true })
      const original = err instanceof Error ? err.message : String(err)
      throw new Error(`Scaffold rolled back: bot preset failed.\nOriginal error: ${original}`)
    }
  }
}
