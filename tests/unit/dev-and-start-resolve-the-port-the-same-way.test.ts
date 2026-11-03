import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { resolveListenPort } from '../../packages/theo/src/cli/commands/resolve-listen-port.js'

/**
 * `theokit start` read `PORT` (usetheokit/theokit#402) and `theokit dev` did not: with `PORT=3199`
 * the first listened on 3199 and the second on `config.port` (3000). A script or container that sets
 * `PORT` for both commands got the port it asked for from only one of them (#1134).
 *
 * The rule is one function, so the two commands cannot drift again.
 */
describe('the listen port', () => {
  it('test_the_flag_beats_the_environment_and_the_config', () => {
    expect(resolveListenPort(4001, { PORT: '4002' }, 4003)).toBe(4001)
  })

  it('test_the_environment_beats_the_config', () => {
    expect(resolveListenPort(undefined, { PORT: '4002' }, 3000)).toBe(4002)
  })

  it('test_the_config_is_the_fallback', () => {
    expect(resolveListenPort(undefined, {}, 3000)).toBe(3000)
  })

  it.each(['', 'abc', ' '])('test_a_PORT_that_is_not_a_number_%j_is_ignored', (value) => {
    expect(resolveListenPort(undefined, { PORT: value }, 3000)).toBe(3000)
  })

  it('test_port_zero_from_the_flag_is_kept_because_it_means_pick_a_free_port', () => {
    expect(resolveListenPort(0, { PORT: '4002' }, 3000)).toBe(0)
  })
})

describe('both commands use that rule', () => {
  const read = (path: string) =>
    readFileSync(resolve(__dirname, '../../packages/theo/src/cli/commands', path), 'utf8')

  it.each(['dev.ts', 'start/index.ts'])(
    'test_%s_resolves_the_port_through_the_shared_function',
    (file) => {
      expect(read(file)).toMatch(/resolveListenPort\(/)
    },
  )

  it('test_neither_command_reads_PORT_on_its_own', () => {
    expect(read('dev.ts')).not.toMatch(/process\.env\.PORT/)
    expect(read('start/index.ts')).not.toMatch(/process\.env\.PORT/)
  })
})
