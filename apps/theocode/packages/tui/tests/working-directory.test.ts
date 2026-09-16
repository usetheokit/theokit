/**
 * B-057 — one source for the working directory, and a second write is refused.
 */
import { afterEach, describe, expect, it } from 'vitest'

import {
  WorkingDirectoryAlreadySetError,
  resetWorkingDirectoryForTest,
  setWorkingDirectory,
  workingDirectory,
} from '../src/working-directory.js'

afterEach(() => {
  resetWorkingDirectoryForTest()
})

describe('B-057 — the working directory has one source', () => {
  it('test_it_falls_back_to_the_process_directory', () => {
    // Every current caller relies on this: the TUI has no directory flag yet.
    expect(workingDirectory()).toBe(process.cwd())
  })

  it('test_what_was_set_is_what_is_read', () => {
    setWorkingDirectory('/selected/project')

    expect(workingDirectory()).toBe('/selected/project')
  })

  it('test_setting_a_different_directory_twice_throws', () => {
    setWorkingDirectory('/first')

    expect(
      () => setWorkingDirectory('/second'),
      'a second write won silently, which is how trust ends up resolved for one directory and ' +
        'configuration for another',
    ).toThrow(WorkingDirectoryAlreadySetError)
  })

  it('test_setting_the_same_directory_twice_is_allowed', () => {
    // Anti-vacuity floor: refusing an idempotent set would make composition order load-bearing for
    // no reason.
    setWorkingDirectory('/same')

    expect(() => setWorkingDirectory('/same')).not.toThrow()
  })
})
