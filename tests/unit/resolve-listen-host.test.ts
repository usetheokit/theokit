import { describe, it, expect } from 'vitest'

import { resolveListenHost } from '../../packages/theo/src/cli/commands/start/resolve-listen-host.js'

/**
 * `config.host` was declared, defaulted to `'localhost'`, documented as the way to
 * open a server to the LAN - and never passed to `server.listen`. Node with no
 * address binds every interface, so the production server listened WIDER than the
 * configuration said, and the default said the narrow thing.
 *
 * That is the inverted direction of a config-that-does-nothing: not a setting with
 * no effect, but a setting whose absence of effect is less safe than its stated
 * value.
 */

describe('the listen address follows the configuration', () => {
  it('test_the_default_binds_the_loopback_and_not_every_interface', () => {
    expect(resolveListenHost('localhost')).toBe('localhost')
  })

  it('test_true_means_every_interface_because_that_is_what_it_is_for', () => {
    // The schema documents `host` as 'Listen on all addresses (0.0.0.0) for
    // LAN/mobile testing', and a boolean is how that intent is expressed.
    expect(resolveListenHost(true)).toBe('0.0.0.0')
  })

  it('test_false_means_the_loopback', () => {
    expect(resolveListenHost(false)).toBe('localhost')
  })

  it('test_an_explicit_address_is_used_verbatim', () => {
    expect(resolveListenHost('127.0.0.1')).toBe('127.0.0.1')
    expect(resolveListenHost('0.0.0.0')).toBe('0.0.0.0')
  })

  it('test_an_absent_host_is_the_loopback_rather_than_everything', () => {
    // The narrow choice is the safe one to make silently. Binding every
    // interface is a decision someone should have to write down.
    expect(resolveListenHost(undefined)).toBe('localhost')
  })
})
