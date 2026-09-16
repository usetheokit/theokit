/**
 * B-041 — the config drift-detectors are RUN, and every knob's reader path resolves.
 *
 * `keysWithoutEnvPath` and `optOutsThatExemptNothing` encode two invariants: every config key is
 * either reachable from the environment or explicitly exempt, and every exemption exempts something
 * real. Both were exported, re-exported from the barrel, and called by nobody — so the invariants
 * were documented and unenforced, which is the same as absent with more words.
 *
 * A detector nobody runs is not a detector. Running them here makes them a gate.
 *
 * Separately, `ENV_KNOBS` names the source that READS each variable, and three of those paths did
 * not resolve — a fabricated citation inside the config layer's own documentation of itself, in the
 * file whose stated purpose is to keep that documentation derivable.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  CONFIG_SCHEMA_KEYS,
  ENV_OPT_OUTS,
  keysWithoutEnvPath,
  optOutsThatExemptNothing,
} from '../../src/config/config.js'
import { ENV_KNOBS } from '../../src/config/env-knobs.js'

const ROOT = join(import.meta.dirname, '../../../..')

/**
 * The config keys the schema accepts — DERIVED, not retyped.
 *
 * B-135. This was a hand-maintained list, and it had drifted: `memory` became a config key and was
 * never added, so the detector below asserted "every config key is either reachable from the
 * environment or explicitly exempt" while never looking at one of them. A gate whose input is a copy
 * of the thing it checks stops being a gate the first time somebody forgets to update the copy — and
 * it fails in the reassuring direction, reporting green about a key it never read.
 *
 * `profile` and `profiles` are appended because they live on the outer `configSchema` rather than in
 * `CONFIG_SCHEMA_KEYS`, which covers the scalars. They are the only two, and both are exempt.
 */
const SCHEMA_KEYS = [...CONFIG_SCHEMA_KEYS, 'profile', 'profiles']

/** The keys ENV_KNOBS says are reachable from the environment. */
const WITH_ENV_PATH = new Set(ENV_KNOBS.map((k) => k.name.replace(/^THEOCODE_/, '').toLowerCase()))

describe('B-041 — the config invariants are enforced, not merely written', () => {
  it('test_the_key_list_is_derived_from_the_schema_rather_than_retyped', () => {
    // B-135 — the anti-drift assertion. Without it the two lists can diverge again and the detector
    // goes on reporting green about a key it never read.
    for (const key of CONFIG_SCHEMA_KEYS) {
      expect(SCHEMA_KEYS, `schema key ${key} is not covered by the detector`).toContain(key)
    }
  })

  it('test_every_config_key_is_reachable_from_the_environment_or_exempt', () => {
    expect(
      keysWithoutEnvPath(SCHEMA_KEYS, WITH_ENV_PATH, ENV_OPT_OUTS),
      'a config key can be set in a file and not in the environment, with no recorded reason',
    ).toEqual([])
  })

  it('test_every_opt_out_exempts_something_real', () => {
    expect(
      optOutsThatExemptNothing(SCHEMA_KEYS, WITH_ENV_PATH, ENV_OPT_OUTS),
      'an exemption names a key the schema does not have, or one that IS reachable — so it exempts nothing',
    ).toEqual([])
  })

  it('test_the_detectors_can_actually_fail', () => {
    // Anti-vacuity floor: both assertions above pass trivially if the detectors always return [].
    expect(keysWithoutEnvPath(['invented_key'], WITH_ENV_PATH, ENV_OPT_OUTS)).toEqual([
      'invented_key',
    ])
    expect(
      optOutsThatExemptNothing(SCHEMA_KEYS, WITH_ENV_PATH, [
        { key: 'not_in_schema', reason: 'x', exitCriterion: 'y' },
      ]),
    ).toEqual(['not_in_schema'])
  })

  it('test_every_knob_names_a_reader_that_exists', () => {
    const missing = ENV_KNOBS.map((k) => k.reader.split(':')[0] ?? '')
      .filter((f) => f.includes('/'))
      .filter((f) => !existsSync(join(ROOT, f)))

    expect(missing, 'a knob cites a reader file that does not exist').toEqual([])
  })
})
