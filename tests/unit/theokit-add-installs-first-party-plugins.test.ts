import { describe, expect, it } from 'vitest'

import {
  InvalidPackageNameError,
  KNOWN_PACKAGES,
  runAdd,
  validatePackageInput,
} from '../../packages/theo/src/cli/commands/add.js'

/**
 * #1076 — `theokit --help` and the Plugins page say `theokit add @theokit/plugin-payments` installs a
 * plugin. The whitelist held five bundled build targets and the name check refused every scoped
 * name, so the documented command failed.
 */
const FIRST_PARTY_PLUGINS = [
  'plugin-canvas',
  'plugin-copilot',
  'plugin-db-drizzle',
  'plugin-email',
  'plugin-forms',
  'plugin-payments',
  'plugin-realtime',
  'plugin-voice',
]

async function installCall(input: string): Promise<{ cmd: string; args: string[] }> {
  let call: { cmd: string; args: string[] } | undefined
  await runAdd({
    input,
    cwd: '/cwd',
    existsSync: (p: string) => p.endsWith('package-lock.json'),
    spawnPm: async (cmd, args) => {
      call = { cmd, args }
      return { ok: true, code: 0 }
    },
  })
  if (call === undefined) throw new Error(`runAdd(${input}) did not run the package manager`)
  return call
}

describe('theokit add installs the first-party plugins', () => {
  it.each(FIRST_PARTY_PLUGINS)('installs @theokit/%s by its scoped name', async (plugin) => {
    expect(await installCall(`@theokit/${plugin}`)).toEqual({
      cmd: 'npm',
      args: ['install', `@theokit/${plugin}`],
    })
  })

  it.each(FIRST_PARTY_PLUGINS)('installs @theokit/%s by its short name', async (plugin) => {
    expect((await installCall(plugin)).args).toEqual(['install', `@theokit/${plugin}`])
  })

  it('lists every plugin in the whitelist', () => {
    for (const plugin of FIRST_PARTY_PLUGINS) {
      expect(KNOWN_PACKAGES[plugin]?.npm).toBe(`@theokit/${plugin}`)
    }
  })

  it.each(['@other/plugin-db-drizzle', '@theokit/../plugin', '@theokit/Plugin', '@theokit/'])(
    'still refuses %s',
    (input) => {
      expect(() => validatePackageInput(input)).toThrow(InvalidPackageNameError)
    },
  )
})
