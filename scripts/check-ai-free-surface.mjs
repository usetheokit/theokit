#!/usr/bin/env node
/**
 * The gate behind the `remover-dependencia-ai` goal: installing `theokit` must pull ZERO ai-sdk.
 *
 * Two assertions per publishable package:
 *   1. `ai` appears in neither `dependencies` nor `peerDependencies`.
 *   2. no emitted `.js` references `ai` at runtime.
 *
 * ## Two traps this file exists to not fall into
 *
 * **Only `.js` is scanned, never `.d.ts`.** A type declaration legitimately says `from 'ai'`;
 * counting it as a runtime import is how an earlier measurement concluded the whole agent runtime
 * depended on ai when the truth was two dynamic imports in one file.
 *
 * **A missing `dist/` is a FAILURE, not a pass.** Globbing an unbuilt package returns nothing, the
 * problem list stays empty, and the gate reports success having measured zero files — which is
 * exactly how the `surface parity` CI job stayed green-looking while being red for weeks. Absence
 * of the artefact is absence of measurement.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const RUNTIME_AI = /from\s*["']ai["']|require\(\s*["']ai["']\s*\)|import\(\s*["']ai["']\s*\)/

/** Recursively collect `.js` files under a directory. Returns [] when the directory is absent. */
function jsFiles(dir) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const out = []
  for (const e of entries) {
    const full = join(dir, e.name)
    if (e.isDirectory()) out.push(...jsFiles(full))
    else if (e.name.endsWith('.js')) out.push(full)
  }
  return out
}

function publishablePackages(root) {
  const pkgDir = join(root, 'packages')
  const out = []
  for (const name of readdirSync(pkgDir)) {
    const dir = join(pkgDir, name)
    if (!statSync(dir).isDirectory()) continue
    let manifest
    try {
      manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    } catch {
      continue
    }
    if (manifest.private === true) continue
    out.push({ dir, manifest })
  }
  return out
}

export function checkAiFreeSurface(root = process.cwd()) {
  const problems = []
  for (const { dir, manifest } of publishablePackages(root)) {
    const name = manifest.name
    for (const block of ['dependencies', 'peerDependencies']) {
      if (manifest[block]?.ai !== undefined) {
        problems.push(`${name}: declara \`ai\` em ${block} (${manifest[block].ai})`)
      }
    }

    const files = jsFiles(join(dir, 'dist'))
    if (files.length === 0) {
      problems.push(
        `${name}: sem \`dist/*.js\` — rode o build. Sem o artefato este gate não mede nada, ` +
          'e um gate que não mede não deve reportar sucesso.',
      )
      continue
    }
    for (const f of files) {
      if (RUNTIME_AI.test(readFileSync(f, 'utf8'))) {
        problems.push(`${name}: ${f.replace(root + '/', '')} referencia \`ai\` em runtime`)
      }
    }
  }
  return problems
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const problems = checkAiFreeSurface()
  if (problems.length > 0) {
    console.error(`\ncheck-ai-free-surface: ${problems.length} problema(s)\n`)
    for (const p of problems) console.error(`  - ${p}`)
    console.error('')
    process.exit(1)
  }
  console.log('check-ai-free-surface: OK — nenhum pacote publicável carrega `ai`.')
}
