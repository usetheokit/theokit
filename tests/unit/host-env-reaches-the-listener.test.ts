/**
 * `HOST` never worked. Every app's `config.host` was the string `localhost` before
 * `resolveListenTarget` ever saw it, because the schema applied that default during parse — and the
 * function ranks any non-empty string as `source: 'config'`, which outranks the environment.
 *
 * The precedence logic was right in isolation; the default upstream removed the case it depended
 * on. So the container fix this was written for (usetheokit/theokit#402) shipped inert: a platform
 * that sets `HOST=0.0.0.0` got a server bound to the loopback, and — because the provenance now
 * reads `config` — a startup line with no hint that anything had been overridden. That is the same
 * indistinguishability `describeListenTarget` exists to remove, arriving by another door.
 *
 * The fix keeps the DECISION distinguishable from the DEFAULT: an app that writes
 * `host: 'localhost'` still outranks `HOST`, because that is a choice; an app that writes nothing
 * lets the environment speak, because silence is not a choice.
 */
import { describe, it, expect } from 'vitest'

import { resolveListenTarget } from '../../packages/theo/src/cli/commands/start/resolve-listen-host.js'
import { theoConfigSchema } from '../../packages/theo/src/config/schema.js'

describe('HOST reaches the listener for an app that never mentions host', () => {
  it('a parsed config leaves `host` absent when the app did not set it', () => {
    // The load-bearing assertion. With a default here, every case below is unreachable.
    expect(theoConfigSchema.parse({}).host).toBeUndefined()
  })

  it('honours HOST end-to-end, through the schema, as a container platform sets it', () => {
    const config = theoConfigSchema.parse({})
    expect(resolveListenTarget(config.host, '0.0.0.0')).toEqual({
      host: '0.0.0.0',
      source: 'env',
    })
  })

  it('still binds the loopback when nothing is set anywhere', () => {
    const config = theoConfigSchema.parse({})
    // The `undefined` is NOT redundant: the parameter defaults to `process.env.HOST`, so omitting
    // it would make this assertion read the ambient environment and pass or fail depending on the
    // shell that ran it. Passing it explicitly is what makes "nothing is set anywhere" true.
    // eslint-disable-next-line sonarjs/no-undefined-argument -- see above; the default reads process.env
    const target = resolveListenTarget(config.host, undefined)
    expect(target).toEqual({ host: 'localhost', source: 'default' })
  })

  it('an explicit `host: "localhost"` still outranks HOST — a decision beats a deployment detail', () => {
    const config = theoConfigSchema.parse({ host: 'localhost' })
    expect(resolveListenTarget(config.host, '0.0.0.0')).toEqual({
      host: 'localhost',
      source: 'config',
    })
  })

  it('`host: false` still refuses the environment', () => {
    const config = theoConfigSchema.parse({ host: false })
    expect(resolveListenTarget(config.host, '0.0.0.0')).toEqual({
      host: 'localhost',
      source: 'default',
    })
  })
})
