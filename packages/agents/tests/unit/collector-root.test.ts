import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

describe('an existing marker in another file name and schema', () => {
  const existingMarker = {
    fileName: '.legacy-collector.json',
    ownerOf: (parsed: unknown): string | undefined => {
      const p = parsed as { product?: unknown; version?: unknown } | null
      return p?.version === 1 && typeof p.product === 'string' ? p.product : undefined
    },
  }
  const legacy = (): string => join(home, '.legacy-collector.json')

  it('is read as the owner and claiming for that owner writes nothing', () => {
    writeFileSync(legacy(), JSON.stringify({ product: 'theocode', version: 1 }))
    expect(collectorRootOwner(projects)).toBeUndefined()
    expect(collectorRootOwner(projects, { existingMarker })).toEqual({ app: 'theocode' })
    claimCollectorRoot(projects, { app: 'theocode' }, { existingMarker })
    expect(() => readFileSync(join(home, '.theokit-collector.json'))).toThrow()
  })

  it('refuses another app, a future version and malformed content', () => {
    for (const text of [
      JSON.stringify({ product: 'other', version: 1 }),
      JSON.stringify({ product: 'theocode', version: 2 }),
      '{not json',
    ]) {
      writeFileSync(legacy(), text)
      expect(() => {
        claimCollectorRoot(projects, { app: 'theocode' }, { existingMarker })
      }).toThrow(CollectorRootNotOwnedError)
    }
  })

  it('the standard marker wins when both exist', () => {
    writeFileSync(legacy(), JSON.stringify({ product: 'theocode', version: 1 }))
    writeFileSync(join(home, '.theokit-collector.json'), JSON.stringify({ app: 'other' }))
    expect(collectorRootOwner(projects, { existingMarker })).toEqual({ app: 'other' })
  })

  it('a malformed standard marker does not hide the existing marker', () => {
    writeFileSync(legacy(), JSON.stringify({ product: 'other', version: 1 }))
    writeFileSync(join(home, '.theokit-collector.json'), '{not json')
    expect(collectorRootOwner(projects, { existingMarker })).toEqual({ app: 'other' })
    expect(() => {
      claimCollectorRoot(projects, { app: 'theocode' }, { existingMarker })
    }).toThrow(CollectorRootNotOwnedError)
  })

  it('an unreadable marker file throws CollectorRootError', () => {
    mkdirSync(legacy())
    expect(() => collectorRootOwner(projects, { existingMarker })).toThrow(CollectorRootError)
  })
})
