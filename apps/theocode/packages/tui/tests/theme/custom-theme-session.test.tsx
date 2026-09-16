/**
 * A custom theme repaints the frame, not merely the module's own idea of the base.
 *
 * Same discipline as `theme-session.test.tsx`: the only assertion worth making goes through a
 * MOUNT, because the defect that file exists for was a correct value never reaching the provider.
 * Here the token is `diff.addedBg` for the same reason — it is one this product does not override
 * in any base, so a custom theme's value for it can only come from the custom theme.
 */
import { render } from 'ink-testing-library'
import { Text } from 'ink'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ReactElement } from 'react'

import { useTheoTheme } from '@theokit/tui'

import { loadCustomTheme } from '../../src/theme/custom-theme.js'
import {
  resetSessionThemeForTest,
  setSessionTheme,
  ThemedSurface,
} from '../../src/theme/theme-session.js'

let home: string

function Probe(): ReactElement {
  const theme = useTheoTheme()
  return <Text>{`addedBg=${theme.diff.addedBg || '(empty)'}`}</Text>
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'theocode-custom-theme-'))
  mkdirSync(join(home, '.claude', 'themes'), { recursive: true })
  writeFileSync(
    join(home, '.claude', 'themes', 'midnight.json'),
    JSON.stringify({ name: 'Midnight', base: 'dark', overrides: { diffAdded: '#0a0a0a' } }),
  )
})
afterEach(() => {
  resetSessionThemeForTest()
  rmSync(home, { recursive: true, force: true })
})

describe('a custom theme reaches the provider', () => {
  it('test_the_custom_value_is_what_a_child_reads', () => {
    const loaded = loadCustomTheme('midnight', home)
    expect(loaded, 'the fixture theme did not load — the assertion below would be vacuous').not.toBeNull()

    const frame = render(
      <ThemedSurface>
        <Probe />
      </ThemedSurface>,
    )
    expect(frame.lastFrame(), 'the custom value was applied before it was selected').not.toContain(
      '#0a0a0a',
    )

    setSessionTheme(loaded!.prop)
    frame.rerender(
      <ThemedSurface>
        <Probe />
      </ThemedSurface>,
    )
    expect(frame.lastFrame()).toContain('addedBg=#0a0a0a')
    frame.unmount()
  })
})
