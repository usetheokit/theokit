/**
 * The session id is IN the transcript, not in its filename.
 *
 * `@theokit/sdk@5.x` changed where a transcript is written:
 *
 *   4.52.1  `${safeSessionId(sessionId)}.jsonl`   — the filename IS the id
 *   5.0.1   `${sessionUuidFor(sessionId)}.jsonl`  — SHA-256 over a namespace, one-way
 *
 * `listSessions` derived the id by stripping `.jsonl` from the name, so on 5.x every caller got a
 * UUID where it expected the id it had passed in. That is one defect with many faces: listing,
 * protection, GC and deletion all key on that id, so all of them broke together
 * (usetheokit/theokit#654).
 *
 * The SDK exports no reverse mapping and `sessionUuidFor` is in no `.d.ts`, so re-deriving the name
 * is not available and reimplementing the hash would be a second implementation of an SDK internal
 * — the failure `subagents-loader`'s docblock says this layer exists to prevent.
 *
 * The record itself carries `sessionId`, on both majors, written by the SDK. Reading the id from
 * the content is authoritative rather than inferred, and it is the same answer under either naming
 * scheme — which is what lets one package support both.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { transcriptPath } from '@theokit/sdk/persistence'
import { mkdtempSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { projectDirFor } from '../../src/session/project-index.js'
import { listSessions } from '../../src/session/session-lifecycle.js'

const CWD = '/tmp/a-project'
let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'theokit-session-id-'))
})
afterEach(() => {
  // best effort; the OS reclaims the tmpdir
})

function writeRealisticTranscript(sessionId: string): void {
  const path = (transcriptPath as (b: string, c: string, s: string) => string)(root, CWD, sessionId)
  mkdirSync((projectDirFor as (c: string, r: string) => string)(CWD, root), { recursive: true })
  // The shape the SDK actually writes, measured on a real transcript under ~/.theokit/projects.
  const record = {
    type: 'user',
    message: { role: 'user', content: 'hello' },
    uuid: '00000000-0000-4000-8000-000000000000',
    parentUuid: null,
    sessionId,
    timestamp: new Date(0).toISOString(),
    isSidechain: false,
    userType: 'external',
    cwd: CWD,
    version: '1.0.0',
  }
  writeFileSync(path, `${JSON.stringify(record)}\n`, 'utf8')
}

describe('listSessions reports the id the caller knows (#654)', () => {
  it('test_the_id_comes_from_the_record_not_the_filename', async () => {
    writeRealisticTranscript('older')

    const ids = (await listSessions(CWD, root)).map((s) => s.id)

    expect(ids, 'on SDK 5.x the filename is a one-way hash of this id').toContain('older')
  })

  it('test_a_transcript_with_no_readable_record_is_listed_without_an_id', async () => {
    // CHANGED by usetheokit/theokit#668, and worth saying why rather than quietly editing it.
    //
    // This test asserted the OLD contract — that an unreadable transcript reports the filename as
    // its id — and that contract was the defect. It was written here during #654 with the reasoning
    // "reporting the on-disk name is worse than the id and far better than dropping the session out
    // of the listing". The second half is right and still holds: the entry is still listed. The
    // first half is not. On 5.x the name is a one-way hash, so the fallback was not a worse id, it
    // was an identifier belonging to no session — and protection was keyed on it, which made a
    // DECLARED-protected session collectable.
    //
    // Listing an entry and naming it are separate properties. The entry survives; the name does not
    // get invented.
    const path = (transcriptPath as (b: string, c: string, s: string) => string)(
      root,
      CWD,
      'orphan',
    )
    mkdirSync((projectDirFor as (c: string, r: string) => string)(CWD, root), { recursive: true })
    writeFileSync(path, '', 'utf8')

    const sessions = await listSessions(CWD, root)

    expect(sessions, 'an unreadable transcript must still be listed').toHaveLength(1)
    expect(sessions[0]?.id, 'no id may be invented from the filename').toBeUndefined()
    expect(sessions[0]?.idSource).toBe('unavailable')
  })
})
