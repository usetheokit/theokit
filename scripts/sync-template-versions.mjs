#!/usr/bin/env node
/**
 * Verifies template package.json.tmpl versions match the monorepo workspace
 * versions. Run with --write to auto-fix drift.
 *
 * The drift engine is exported as `syncTemplates()` (pure, sandbox-testable);
 * the CLI at the bottom builds the workspace "truth" and runs it over the
 * real templates dir. Importing this module does NOT run the CLI (guarded by
 * the import.meta main-check), so unit tests can import `syncTemplates`
 * without side effects.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** Dependency buckets we keep in sync with the workspace. */
const MANAGED_BUCKETS = ['dependencies', 'devDependencies']

/**
 * Find every `package.json.tmpl` under `templatesDir`, descending at most
 * `maxDepth` directory levels (a direct child of `templatesDir` is depth 0).
 * This covers both flat templates (`templates/default/`) and the nested
 * `templates/services/agent-node/` layout, while bounding the walk.
 */
function findTemplateManifests(templatesDir, maxDepth) {
  const out = []
  function walk(dir, depth) {
    if (depth > maxDepth) return
    const tmpl = join(dir, 'package.json.tmpl')
    if (existsSync(tmpl)) out.push(tmpl)
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.isDirectory()) walk(join(dir, entry.name), depth + 1)
    }
  }
  let roots
  try {
    roots = readdirSync(templatesDir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of roots) {
    if (entry.isDirectory()) walk(join(templatesDir, entry.name), 0)
  }
  return out
}

/**
 * Detect (and in `write` mode, correct) drift in a single dependency bucket.
 * Mutates `deps` in place when writing. Returns drift entries + whether any
 * pin changed.
 */
function collectBucketDrift(deps, truth, mode) {
  const drifted = []
  let changed = false
  for (const [dep, current] of Object.entries(deps)) {
    // EC-4: only ever touch deps already declared in the template — never add.
    if (!Object.hasOwn(truth, dep)) continue
    // EC-3: workspace:* is intentional inside the monorepo — leave it alone.
    if (current === 'workspace:*') continue
    const expected = truth[dep]
    if (current === expected) continue
    drifted.push({ dep, current, expected })
    if (mode === 'write') {
      deps[dep] = expected
      changed = true
    }
  }
  return { drifted, changed }
}

/**
 * Compare one template manifest's managed deps against `truth`. In `write`
 * mode the file is rewritten with the corrected pins. Returns the drift
 * entries plus whether the file was written.
 */
function processManifest(file, truth, mode) {
  const pkg = JSON.parse(readFileSync(file, 'utf-8'))
  const drifted = []
  let changed = false
  for (const bucket of MANAGED_BUCKETS) {
    const deps = pkg[bucket]
    if (deps === undefined || deps === null) continue
    const result = collectBucketDrift(deps, truth, mode)
    for (const entry of result.drifted) drifted.push({ ...entry, file })
    if (result.changed) changed = true
  }
  let written = 0
  if (mode === 'write' && changed) {
    writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n')
    written = 1
  }
  return { drifted, written }
}

/**
 * Sync template `package.json.tmpl` dependency pins to the supplied `truth`.
 *
 * @param {object} options
 * @param {'check'|'write'} [options.mode='check'] — report drift only, or rewrite.
 * @param {string} options.templatesDir — directory to walk for templates.
 * @param {Record<string,string>} options.truth — dep name → expected version range.
 * @param {number} [options.maxDepth=2] — directory levels to descend.
 * @returns {{ total: number, drifted: Array<{dep:string,current:string,expected:string,file:string}>, written: number }}
 */
export function syncTemplates({ mode = 'check', templatesDir, truth, maxDepth = 2 }) {
  const files = findTemplateManifests(templatesDir, maxDepth)
  const drifted = []
  let written = 0
  for (const file of files) {
    const result = processManifest(file, truth, mode)
    drifted.push(...result.drifted)
    written += result.written
  }
  return { total: files.length, drifted, written }
}

// ── CLI ──

function buildWorkspaceTruth(root) {
  const truth = {}
  for (const pkg of ['packages/theo', 'packages/http', 'packages/agents']) {
    try {
      const meta = JSON.parse(readFileSync(resolve(root, pkg, 'package.json'), 'utf-8'))
      if (meta.name && meta.version) truth[meta.name] = `^${meta.version}`
    } catch {
      /* skip if not found */
    }
  }
  return truth
}

function runCli() {
  const here = dirname(fileURLToPath(import.meta.url))
  const root = resolve(here, '..')
  const mode = process.argv.includes('--write') ? 'write' : 'check'
  const truth = buildWorkspaceTruth(root)
  const templatesDir = resolve(root, 'packages/create-theokit/templates')

  const { drifted, written } = syncTemplates({ mode, templatesDir, truth })

  for (const d of drifted) {
    const tag = mode === 'write' ? 'Fixed' : 'Drift'
    console.log(`  ${tag}: ${d.dep} ${d.current} -> ${d.expected}`)
  }
  if (mode === 'write') {
    console.log(`  Wrote ${written} file(s).`)
  } else if (drifted.length > 0) {
    console.log('\nRun `pnpm sync:templates --write` to fix.')
    process.exit(1)
  }
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? '').href
if (isMain) runCli()
