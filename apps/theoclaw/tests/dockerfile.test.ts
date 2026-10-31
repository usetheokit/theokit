import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * The image's shape, read offline (B-374, T5.1). Building and running it is the container check
 * (`tests/container/image.container.test.ts`), which needs Docker and runs on a dispatched CI run.
 */
const APP_DIR = fileURLToPath(new URL('..', import.meta.url))
const ROOT = join(APP_DIR, '..', '..')
const DOCKERFILE = readFileSync(join(APP_DIR, 'Dockerfile'), 'utf8')
const IGNORE = readFileSync(join(APP_DIR, 'Dockerfile.dockerignore'), 'utf8')

/** Every `ENV` instruction's `KEY=value` pairs, joined continuation lines included. */
function envOf(dockerfile: string): Record<string, string> {
  const joined = dockerfile.replace(/\\\n\s*/g, ' ')
  const pairs = [...joined.matchAll(/^ENV (.+)$/gm)].flatMap((match) => match[1]!.trim().split(/\s+/))
  return Object.fromEntries(pairs.map((pair) => [pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1)]))
}

/** The sources of every `COPY` that reads the build context (not `--from=`). */
function contextSources(dockerfile: string): string[] {
  return [...dockerfile.matchAll(/^COPY (?!--from)(.+)$/gm)].flatMap((match) => {
    const parts = match[1]!.trim().split(/\s+/).filter((part) => !part.startsWith('--'))
    return parts.slice(0, -1)
  })
}

describe('the TheoClaw Dockerfile', () => {
  it('the Dockerfile copies only paths that exist and runs the entry as node', () => {
    expect(DOCKERFILE).toMatch(/^USER node$/m)
    expect(DOCKERFILE).toMatch(/dist\/main\.js/)
    expect(DOCKERFILE).toMatch(/^EXPOSE 8787$/m)
    const sources = contextSources(DOCKERFILE)
    expect(sources.length).toBeGreaterThan(0)
    for (const source of sources) expect(existsSync(join(ROOT, source)), source).toBe(true)
  })

  it('the Dockerfile builds without pnpm deploy and runs the copied workspace entry', () => {
    expect(DOCKERFILE).not.toMatch(/pnpm[^\n]*deploy/)
    expect(DOCKERFILE).toMatch(/COPY --from=builder \/repo \/app/)
    expect(DOCKERFILE).toMatch(/\/app\/apps\/theoclaw\/dist\/main\.js/)
    expect(DOCKERFILE).toMatch(/--frozen-lockfile --filter 'theoclaw\.\.\.'/)
  })

  it('the image keeps every write under /data', () => {
    expect(envOf(DOCKERFILE).THEOKIT_HOME).toBe('/data/theokit')
    expect(envOf(DOCKERFILE).THEOCLAW_STATE_DIR).toBe('/data/state')
    expect(envOf(DOCKERFILE).THEOCLAW_WORKSPACE).toBe('/data/work')
    expect(envOf(DOCKERFILE).THEOCLAW_CONFIG).toBe('/data/theoclaw.env')
    expect(DOCKERFILE).toMatch(/^VOLUME \/data$/m)
  })

  it('the build context leaves out nested node_modules, builds, git and environment files', () => {
    const patterns = IGNORE.split('\n').map((line) => line.trim())
    for (const pattern of ['**/node_modules', '**/dist', '.git', '**/.env', '**/.env.*', '**/*.env', '!**/.env.example']) {
      expect(patterns, pattern).toContain(pattern)
    }
    // The root file's entries are carried over, so whatever it leaves out stays out here too.
    const root = readFileSync(join(ROOT, '.dockerignore'), 'utf8').split('\n').map((line) => line.trim())
    for (const entry of root.filter((line) => line !== '' && !line.startsWith('#'))) expect(patterns, entry).toContain(entry)
  })
})
