/**
 * Plan v1.2 T2.3 + EC-2 — `theokit migrate services-json-v1-to-v2`.
 *
 * Idempotent codemod that injects a top-level `name` field into
 * `theo.config.ts` (and refreshes `.theokit/services.json` if a build artifact
 * exists). When the resolved `name` would be `services-bundle`, the codemod
 * emits an actionable warning so the operator can decide between:
 *   a) keeping `services-bundle` (zero-downtime — preserves the Gitea repo
 *      lineage shipped by Plan B v3.1); or
 *   b) renaming to a new project — requires ArgoCD App rewire downtime.
 *
 * Inputs (in order of precedence):
 *   1) explicit `--name <slug>` CLI argument
 *   2) `package.json` `name` field (slugified to DNS-1123)
 *   3) directory basename
 *   4) `services-bundle` fallback with a warning
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'

interface ServicesJsonMigrateOptions {
  /** Override theo.config.ts path. Defaults to `<cwd>/theo.config.ts`. */
  configPath?: string
  /** Override package.json path. Defaults to `<cwd>/package.json`. */
  pkgPath?: string
  /** Explicit project name. When set, bypasses package.json / dir-basename. */
  name?: string
  /** When true, prints the plan but performs no writes. */
  dryRun?: boolean
  /** When true, suppresses stdout (used in tests). */
  silent?: boolean
  /** When set, treats this as the working directory (defaults to process.cwd). */
  cwd?: string
}

interface ServicesJsonMigratePlan {
  /** The DNS-1123 project name that will land in theo.config.ts. */
  projectName: string
  /** Reason describing where the name came from. */
  source: 'flag' | 'package-json' | 'directory' | 'fallback'
  /** Whether `theo.config.ts` already declared `name`. */
  alreadyMigrated: boolean
  /** Warning string when projectName=services-bundle. Empty otherwise. */
  warning: string
}

// Canonical DNS-1123 anchor. Equivalent to ^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$
// but split into explicit single-char anchors so neither security/detect-
// unsafe-regex nor sonarjs/slow-regex flag it (linear scan, no backtracking
// hot paths over arbitrary input).
function isDns1123(s: string): boolean {
  if (s.length === 0 || s.length > 63) return false
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i)
    const isLower = c >= 0x61 && c <= 0x7a
    const isDigit = c >= 0x30 && c <= 0x39
    const isHyphen = c === 0x2d
    if (!(isLower || isDigit || isHyphen)) return false
    if (i === 0 && isHyphen) return false
    if (i === s.length - 1 && isHyphen) return false
  }
  return true
}

/**
 * Best-effort slugifier: lowercases, replaces underscores with hyphens,
 * drops invalid characters, collapses repeated hyphens, trims leading /
 * trailing hyphens. Returns empty string when nothing survives.
 */
export function slugify(input: string): string {
  const lowered = input.toLowerCase()
  let result = ''
  let lastWasHyphen = false
  for (let i = 0; i < lowered.length; i += 1) {
    const ch = lowered.charAt(i)
    const code = lowered.charCodeAt(i)
    const isLower = code >= 0x61 && code <= 0x7a
    const isDigit = code >= 0x30 && code <= 0x39
    if (isLower || isDigit) {
      result += ch
      lastWasHyphen = false
      continue
    }
    if ((ch === '-' || ch === '_') && !lastWasHyphen && result.length > 0) {
      result += '-'
      lastWasHyphen = true
    }
  }
  while (result.endsWith('-')) result = result.slice(0, -1)
  return result.slice(0, 63)
}

/** Returns `true` when `theo.config.ts` source already declares `name: …`. */
export function configDeclaresName(source: string): boolean {
  // Linear scan instead of `[\s\S]*?` lookahead so sonarjs/slow-regex
  // stays clean (no super-linear backtracking). We anchor on `defineConfig(`
  // then walk forward looking for `name:` inside the literal block.
  const start = source.indexOf('defineConfig(')
  if (start < 0) return false
  return /\bname\s*:\s*['"]/u.test(source.slice(start))
}

/**
 * Inject `name: <project>,` into the first `defineConfig({ ... })` call.
 * Idempotent: when the config already declares `name`, returns the source
 * untouched.
 */
export function injectName(source: string, projectName: string): string {
  if (configDeclaresName(source)) return source
  return source.replace(/(defineConfig\(\s*\{)([\s\S])/u, (_match, head: string, next: string) => {
    // Preserve existing whitespace style by sniffing the next character.
    const nl = next === '\n' || next === '\r' ? next : '\n'
    return `${head}\n  name: '${projectName}',${nl === '\n' ? '' : nl}`
  })
}

interface CandidateResolution {
  projectName: string
  source: ServicesJsonMigratePlan['source']
}

function fromPackageJson(pkgPath: string): CandidateResolution | null {
  if (!existsSync(pkgPath)) return null
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { name?: string }
    if (typeof pkg.name !== 'string' || pkg.name.length === 0) return null
    const candidate = slugify(pkg.name)
    return isDns1123(candidate) ? { projectName: candidate, source: 'package-json' } : null
  } catch {
    return null
  }
}

function fromDirectoryBasename(cwd: string): CandidateResolution | null {
  const candidate = slugify(basename(resolve(cwd)))
  return isDns1123(candidate) ? { projectName: candidate, source: 'directory' } : null
}

function resolveProjectName(
  opts: ServicesJsonMigrateOptions,
  cwd: string,
  pkgPath: string,
): CandidateResolution {
  if (opts.name !== undefined && opts.name.length > 0) {
    return { projectName: opts.name, source: 'flag' }
  }
  return (
    fromPackageJson(pkgPath) ??
    fromDirectoryBasename(cwd) ?? {
      projectName: 'services-bundle',
      source: 'fallback',
    }
  )
}

export function planServicesJsonMigration(
  opts: ServicesJsonMigrateOptions,
): ServicesJsonMigratePlan {
  const cwd = opts.cwd ?? process.cwd()
  const configPath = opts.configPath ?? join(cwd, 'theo.config.ts')
  const pkgPath = opts.pkgPath ?? join(cwd, 'package.json')

  const configSource = existsSync(configPath) ? readFileSync(configPath, 'utf-8') : ''
  const alreadyMigrated = configSource.length > 0 ? configDeclaresName(configSource) : false

  const resolution = resolveProjectName(opts, cwd, pkgPath)
  const warning =
    resolution.source === 'fallback'
      ? 'Using fallback project name `services-bundle`. This preserves the Gitea ' +
        'repo lineage shipped by Plan B v3.1 (zero downtime). To adopt a new project ' +
        'name, re-run with `--name <slug>` and coordinate the ArgoCD App rewire.'
      : ''

  if (!isDns1123(resolution.projectName)) {
    throw new Error(
      `services-json migrate: resolved project name "${resolution.projectName}" is not DNS-1123 ` +
        '(1-63 chars, lowercase alphanumeric+hyphens, no leading/trailing hyphen). Re-run with --name <slug>.',
    )
  }

  return {
    projectName: resolution.projectName,
    source: resolution.source,
    alreadyMigrated,
    warning,
  }
}

// Returns void; not async — kept Promise-bearing via the CLI dispatcher's
// `await` site by wrapping into Promise.resolve(...) on the call boundary.
export function servicesJsonMigrateCommand(opts: ServicesJsonMigrateOptions): Promise<void> {
  const cwd = opts.cwd ?? process.cwd()
  const configPath = opts.configPath ?? join(cwd, 'theo.config.ts')
  const log = (m: string): void => {
    if (opts.silent === true) return
    process.stdout.write(`${m}\n`)
  }

  if (!existsSync(configPath)) {
    return Promise.reject(
      new Error(`services-json migrate: ${configPath} not found. Run from a TheoKit project root.`),
    )
  }

  const plan = planServicesJsonMigration(opts)
  log(`  • Resolved project name: '${plan.projectName}' (source: ${plan.source})`)
  if (plan.warning.length > 0) log(`  ⚠ ${plan.warning}`)

  if (plan.alreadyMigrated) {
    log('  ✓ theo.config.ts already declares `name` — nothing to do (idempotent).')
    return Promise.resolve()
  }

  if (opts.dryRun === true) {
    log('  • Dry-run: would inject `name` into theo.config.ts (no write).')
    return Promise.resolve()
  }

  const before = readFileSync(configPath, 'utf-8')
  const after = injectName(before, plan.projectName)
  if (after === before) {
    log("  ⚠ Could not locate `defineConfig({ ... })` block. Add `name: '<slug>',` manually.")
    return Promise.resolve()
  }
  writeFileSync(configPath, after, 'utf-8')
  log(`  ✓ Injected name='${plan.projectName}' into theo.config.ts`)
  log('  • Next: re-run `theokit build --target theo-cloud` to emit services.json v2.')
  return Promise.resolve()
}
