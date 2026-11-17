/**
 * #102 / #1918 — `sessions gc` speaks the registry's vocabulary and protects both transcript names.
 *
 * The framework removes a candidate from the registry by the session id it READ from the transcript,
 * and protects an injected id by its current (hashed) path only. The command adds the 4.x name, the
 * id itself, because an upgraded machine has both on disk. Both arms run the command's function over
 * real files.
 */
import { existsSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { planAndRunCurrentProjectGC } from '../../../../cli/src/commands/sessions.js'
import { NOW, useFixture, writePointer, writeTranscript } from './gc-command-fixture.js'

const AGENT = 'exec-522dc0ef-0bf9-419d-b40c-cf0c81d611e4'
const fx = useFixture()
const run = (registry: { agentId: string; archived?: boolean }[], removed: string[] = []) =>
  planAndRunCurrentProjectGC({
    cwd: fx.cwd,
    root: fx.root,
    now: NOW,
    keepLast: 1,
    maxAgeDays: 1,
    apply: true,
    listRegistry: async () => registry,
    removeFromRegistry: (id) => void removed.push(id),
  })

describe('#102 — deletion speaks the registry vocabulary', () => {
  it('test_a_registered_session_is_deleted_by_its_session_id_not_its_filename', async () => {
    writeTranscript(fx, 'decoy-newer', 1)
    const file = writeTranscript(fx, AGENT, 90)
    const removed: string[] = []

    await run([{ agentId: AGENT, archived: true }], removed)

    expect(removed, 'the registry was handed a transcript filename').toEqual([AGENT])
    expect(existsSync(file)).toBe(false)
  })

  it('test_both_naming_conventions_of_a_live_session_are_protected', async () => {
    writeTranscript(fx, 'decoy-newer', 1)
    const current = writeTranscript(fx, AGENT, 90)
    const legacy = writeTranscript(fx, AGENT, 90, { legacy: true })

    await run([{ agentId: AGENT }])

    expect(existsSync(current), 'the 5.x-named transcript of a live session was deleted').toBe(true)
    expect(existsSync(legacy), 'the 4.x-named transcript of a live session was deleted').toBe(true)
  })

  it('test_both_naming_conventions_of_the_tui_pointer_session_are_protected', async () => {
    writeTranscript(fx, 'decoy-newer', 1)
    const current = writeTranscript(fx, 'tui-live', 90)
    const legacy = writeTranscript(fx, 'tui-live', 90, { legacy: true })
    writePointer(fx, 'tui-live')

    await run([])

    expect(existsSync(current)).toBe(true)
    expect(existsSync(legacy), 'the legacy transcript of the pointed session was deleted').toBe(true)
  })

  it('test_a_legacy_name_the_sdk_sanitises_is_still_protected', async () => {
    // `a.b` is filed as `a-b.jsonl` on 4.x: a stem comparison with the raw id would miss it.
    const id = 'tui.live.1'
    writeTranscript(fx, 'decoy-newer', 1)
    const legacy = writeTranscript(fx, id, 90, { legacy: true })
    writePointer(fx, id)

    await run([])

    expect(existsSync(legacy), 'the sanitised legacy name of the pointed session was deleted').toBe(
      true,
    )
  })
})
