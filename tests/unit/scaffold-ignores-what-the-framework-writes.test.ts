import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { resolveSessionBaseDir } from '../../packages/theo/src/server/agent/mount-agent.js'

/**
 * usetheokit/theokit#395 — every conversation a TheoKit app serves is written to
 * `<app>/.data/agent-sessions/…/<sessionId>.jsonl`, and the scaffold's ignore
 * file listed `data/` — no leading dot. It matched nothing the framework writes.
 *
 * A developer who ran the app once and committed got the full transcript of
 * every turn into version control: prompts, answers, tool inputs, tool results.
 *
 * What made it survive is the comment above `resolveSessionBaseDir`, which
 * asserted the directory was git-ignored. Nobody checks a protection the source
 * says is already there.
 *
 * ## Why this test derives the path instead of writing it down
 *
 * A test asserting the literal `.data/` would pass the day someone moves the
 * transcripts and the ignore file does not follow — the same drift, one release
 * later. It asks the framework where it writes, and then asks whether the
 * template covers that answer.
 */

const TEMPLATE_ROOT = resolve(
  import.meta.dirname,
  '../../packages/create-theokit/templates/default',
)

/** The scaffold ships its ignore file as `_gitignore`; the CLI renames it on write. */
const ignoreLines = readFileSync(resolve(TEMPLATE_ROOT, '_gitignore'), 'utf-8')
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l.length > 0 && !l.startsWith('#'))

/** Does any pattern in the ignore file cover this app-relative path? */
function isIgnored(appRelativePath: string): boolean {
  return ignoreLines.some((pattern) => {
    const dir = pattern.replace(/\/$/u, '')
    return appRelativePath === dir || appRelativePath.startsWith(`${dir}/`)
  })
}

describe('the scaffold ignores what the framework writes into the app (#395)', () => {
  it('test_the_session_transcript_directory_is_ignored', () => {
    const base = resolveSessionBaseDir('/app')
    expect(base, 'the framework must tell us where it writes').toBeDefined()

    // '/app/.data/agent-sessions' -> '.data/agent-sessions'
    const appRelative = base!.slice('/app/'.length)

    expect(
      isIgnored(appRelative),
      `the framework writes conversation transcripts to ${appRelative} and the template does not ignore it`,
    ).toBe(true)
  })

  it('test_a_transcript_file_inside_it_is_ignored_too', () => {
    // The directory pattern must cover the files, not merely the folder entry.
    expect(isIgnored('.data/agent-sessions/projects/abc/session.jsonl')).toBe(true)
  })

  it('test_the_local_database_is_ignored', () => {
    // Same directory, and the reason `data/` looked plausible: the dev DB lives
    // at `.data/app.db` (see the Vite watcher's ignore list).
    expect(isIgnored('.data/app.db')).toBe(true)
  })

  it('test_the_build_output_is_still_ignored', () => {
    // Guard against a fix that rewrites the file and drops what worked.
    expect(isIgnored('.theokit/client/index.html')).toBe(true)
    expect(isIgnored('node_modules/theokit')).toBe(true)
  })
})
