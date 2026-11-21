/**
 * `changeset version` rewrites the exact `workspace:<version>` pins in the TheoCode manifests
 * (`workspace:16.13.0` -> `workspace:17.0.0`) but not `pnpm-lock.yaml`. The release pull request then
 * failed every job that runs `pnpm install --frozen-lockfile` (preview, dep-check). `version-packages`
 * must refresh the lockfile right after `changeset version`.
 *
 * @internal
 */

import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'

describe('version-packages refreshes the lockfile', () => {
  it('runs a lockfile-only install straight after changeset version', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
      scripts: Record<string, string>
    }
    const steps = pkg.scripts['version-packages']!.split('&&').map((s) => s.trim())
    const idx = steps.indexOf('changeset version')
    expect(idx).toBeGreaterThanOrEqual(0)
    expect(steps.filter((s) => s === 'changeset version')).toHaveLength(1)
    expect(steps[idx + 1]).toMatch(/^pnpm install --lockfile-only\b/)
  })
})
