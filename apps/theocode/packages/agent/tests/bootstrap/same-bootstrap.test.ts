import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { expect, it } from 'vitest'

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

it('the CLI, the TUI and the ACP entry all call the same bootstrapSurface', () => {
  expect(read('../../../cli/src/main.ts')).toMatch(
    /import \{ bootstrapSurface \} from '@theocode\/agent\/bootstrap'/,
  )
  expect(read('../../../tui/src/main.tsx')).toMatch(
    /import \{ bootstrapSurface \} from '@theocode\/agent\/bootstrap'/,
  )
  expect(read('../../src/chat/chat-acp.ts')).toMatch(
    /import \{ bootstrapSurface \} from '\.\.\/bootstrap\/index\.js'/,
  )
  for (const f of [
    '../../../cli/src/main.ts',
    '../../../tui/src/main.tsx',
    '../../src/chat/chat-acp.ts',
  ])
    expect(read(f)).toMatch(/bootstrapSurface\(/)
})
