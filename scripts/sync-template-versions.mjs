#!/usr/bin/env node
/**
 * Verifies template package.json versions match the monorepo workspace versions.
 * Run with --write to auto-fix drift.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const write = process.argv.includes('--write')

// Read workspace package versions
const pkgs = ['packages/theo', 'packages/http', 'packages/agents']
const versions = {}
for (const pkg of pkgs) {
  try {
    const p = JSON.parse(readFileSync(resolve(root, pkg, 'package.json'), 'utf-8'))
    versions[p.name] = p.version
  } catch {
    /* skip if not found */
  }
}

// Check template package.json files
let drifted = false
const templatePkgs = ['packages/create-theokit/templates/default/package.json.tmpl']

for (const tmplPath of templatePkgs) {
  const abs = resolve(root, tmplPath)
  try {
    const raw = readFileSync(abs, 'utf-8')
    let updated = raw
    for (const [name, version] of Object.entries(versions)) {
      const escaped = name.replace('/', '\\/')
      const pattern = new RegExp(`"${escaped}":\\s*"[^"]*"`, 'g')
      const replacement = `"${name}": "^${version}"`
      if (pattern.test(raw)) {
        const newRaw = updated.replace(pattern, replacement)
        if (newRaw !== updated) {
          drifted = true
          if (write) {
            updated = newRaw
            console.log(`  Fixed ${name} -> ^${version} in ${tmplPath}`)
          } else {
            console.log(`  Drift: ${name} in ${tmplPath}`)
          }
        }
      }
    }
    if (write && updated !== raw) {
      writeFileSync(abs, updated)
    }
  } catch {
    /* template not found */
  }
}

if (drifted && !write) {
  console.log('\nRun `pnpm sync:templates` to fix.')
  process.exit(1)
}
