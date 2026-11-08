#!/usr/bin/env node
// Full-repository lint in bounded-memory shards.
//
// One `eslint .` with type-aware rules (projectService) keeps every program it opens alive in a
// single process and reached ~4.5 GiB resident, which earlyoom kills on a shared build machine
// (exit 143, no findings). The same files, split across several sequential processes, each peak
// well under 2 GiB. Nothing is dropped: every tracked lintable file lands in exactly one shard
// and ESLint still applies the root config's ignores (`--no-warn-ignored`).
import { execFileSync, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)

export const LINTABLE = /\.(?:[cm]?[jt]s|[jt]sx)$/
export const MAX_FILES_PER_SHARD = 450

/** Group files by their first two path segments, then pack the groups into shards. */
export function planShards(files, max = MAX_FILES_PER_SHARD) {
  const groups = new Map()
  for (const f of [...files].sort()) {
    const key = f.split('/').slice(0, 2).join('/')
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(f)
  }
  const shards = []
  let current = []
  const flush = () => {
    if (current.length > 0) shards.push(current)
    current = []
  }
  for (const group of groups.values()) {
    // A group larger than a shard is split on its own.
    for (let i = 0; i < group.length; i += max) {
      const part = group.slice(i, i + max)
      if (current.length + part.length > max) flush()
      current.push(...part)
    }
  }
  flush()
  return shards
}

function trackedFiles() {
  // `git` is resolved from PATH on purpose: it is the developer's/CI's own tool, not user input.
  const out = execFileSync(
    // eslint-disable-next-line sonarjs/no-os-command-from-path
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    },
  )
  return out.split('\0').filter((f) => f && LINTABLE.test(f))
}

function main() {
  const extra = process.argv.slice(2)
  const shards = planShards(trackedFiles())
  let failed = false
  shards.forEach((shard, i) => {
    console.error(`lint shard ${i + 1}/${shards.length} (${shard.length} files)`)
    const r = spawnSync(
      process.execPath,
      [
        '--max-old-space-size=1536',
        join(dirname(require.resolve('eslint/package.json')), 'bin', 'eslint.js'),
        '--no-warn-ignored',
        ...extra,
        '--',
        ...shard,
      ],
      { stdio: 'inherit' },
    )
    if (r.status !== 0) failed = true
  })
  process.exit(failed ? 1 : 0)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
