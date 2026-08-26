/**
 * `@theokit/agents/pty` still resolves, and every member of it explains the move (#460).
 *
 * The backend left this package because its native install step was paid by every application,
 * including the ones that never open a terminal. Removing the subpath outright would have handed an
 * upgrading consumer `ERR_MODULE_NOT_FOUND` on a specifier that worked yesterday, with nothing to
 * search for. The stub spends the same break on a sentence.
 *
 * The measurement that decided this was NOT "one consumer in the monorepo" — a repository grep
 * cannot see anyone who ran `npm i @theokit/agents` and imported the subpath, which is exactly the
 * population a break lands on. Same blindness that let a broken install sit behind 5000 green tests
 * one layer over.
 */
import { describe, expect, it } from 'vitest'

describe('the pty subpath after the move', () => {
  it('still imports — the specifier resolves rather than failing at module load', async () => {
    const m = await import('../../src/pty-entry.js')
    expect(m).toBeTypeOf('object')
  })

  it('names the new package and the exact import change', async () => {
    const { PtyInteractiveBackend } = await import('../../src/pty-entry.js')
    let message = ''
    try {
      new (PtyInteractiveBackend as unknown as new () => unknown)()
    } catch (e) {
      message = (e as Error).message
    }
    expect(message).toContain('@theokit/agents-pty')
    expect(message).toContain('npm install')
    // The diff, so a reader does not have to work out what changed.
    expect(message).toContain("from '@theokit/agents-pty'")
  })

  it('does NOT reintroduce the dependency it exists to have removed', async () => {
    // A shim that imported `@theokit/sdk-pty` to "keep working" would undo the entire change. This
    // is the assertion that makes the stub safe rather than a compromise.
    const source = (await import('node:fs')).readFileSync(
      new URL('../../src/pty-entry.ts', import.meta.url),
      'utf-8',
    )
    expect(source).not.toMatch(/from '@theokit\/sdk-pty'/)
    expect(source).not.toMatch(/import\(['"]@theokit\/sdk-pty/)
  })

  it('fails on USE, not on import, so a re-export of the path does not break', async () => {
    // A module-level throw fires before any consumer code runs. The failure belongs on the line
    // that actually needed the backend.
    await expect(import('../../src/pty-entry.js')).resolves.toBeTypeOf('object')
  })
})
