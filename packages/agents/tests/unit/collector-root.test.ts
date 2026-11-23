import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  claimCollectorRoot,
  CollectorRootError,
  collectorRootOwner,
  CollectorRootNotOwnedError,
} from '../../src/session/index.js'

let home: string
let projects: string
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'collector-root-'))
  projects = join(home, 'projects')
})
afterEach(() => rmSync(home, { recursive: true, force: true }))

describe('collector root ownership', () => {
  it('a claimed root names its owner', () => {
    expect(collectorRootOwner(projects)).toBeUndefined()
    claimCollectorRoot(projects, { app: 'theocode' })
    expect(collectorRootOwner(projects)).toEqual({ app: 'theocode' })
    claimCollectorRoot(projects, { app: 'theocode' })
  })

  it('never replaces another app’s marker', () => {
    claimCollectorRoot(projects, { app: 'theocode' })
    expect(() => {
      claimCollectorRoot(projects, { app: 'other' })
    }).toThrow(CollectorRootNotOwnedError)
    expect(collectorRootOwner(projects)).toEqual({ app: 'theocode' })
  })

  it('a malformed marker is unowned and is not overwritten silently by a read', () => {
    writeFileSync(join(home, '.theokit-collector.json'), '{not json')
    expect(collectorRootOwner(projects)).toBeUndefined()
  })

  it('claimCollectorRoot on an unwritable parent throws, it does not return silently', () => {
    const file = join(home, 'a-file')
    writeFileSync(file, 'x')
    expect(() => {
      claimCollectorRoot(join(file, 'sub', 'projects'), { app: 'theocode' })
    }).toThrow(CollectorRootError)
  })

  it('an unreadable marker throws instead of reading as not ours', () => {
    mkdirSync(join(home, '.theokit-collector.json'))
    expect(() => collectorRootOwner(projects)).toThrow(CollectorRootError)
  })
})
