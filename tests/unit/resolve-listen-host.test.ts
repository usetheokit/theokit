import { describe, it, expect } from 'vitest'

import {
  describeListenTarget,
  resolveListenTarget,
} from '../../packages/theo/src/cli/commands/start/resolve-listen-host.js'

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
    expect(resolveListenTarget('localhost').host).toBe('localhost')
  })

  it('test_true_means_every_interface_because_that_is_what_it_is_for', () => {
    // The schema documents `host` as 'Listen on all addresses (0.0.0.0) for
    // LAN/mobile testing', and a boolean is how that intent is expressed.
    expect(resolveListenTarget(true).host).toBe('0.0.0.0')
  })

  it('test_false_means_the_loopback', () => {
    expect(resolveListenTarget(false).host).toBe('localhost')
  })

  it('test_an_explicit_address_is_used_verbatim', () => {
    expect(resolveListenTarget('127.0.0.1').host).toBe('127.0.0.1')
    expect(resolveListenTarget('0.0.0.0').host).toBe('0.0.0.0')
  })

  it('test_an_absent_host_is_the_loopback_rather_than_everything', () => {
    // The narrow choice is the safe one to make silently. Binding every
    // interface is a decision someone should have to write down.
    expect(resolveListenTarget(undefined).host).toBe('localhost')
  })
})

/**
 * A container must be reachable, and the log must say which it is
 * (usetheokit/theokit#402).
 *
 * The first version of this file fixed a real defect — `config.host` was declared
 * and never passed to `listen`, so the server bound every interface while its
 * default said `localhost` — and introduced a worse one. Inside a container,
 * `localhost` means nobody: the image starts, prints a URL, and refuses every
 * request, including one from inside itself.
 *
 * Worse than the refusal was the print. `theo start` logged `localhost` whether
 * it had bound the loopback or every interface, so a container serving everyone
 * and a container serving nobody produced byte-identical output. That is
 * `docs/adr/0002-an-abnormal-ending-is-never-reported-as-normal.md` in the
 * startup path: two opposite states, one observable.
 */
describe('the environment gets a say, and the log stops lying (#402)', () => {
  it('test_HOST_is_honoured_when_config_says_nothing', () => {
    // The variable every container platform already sets. Honouring it is what
    // makes the documented Docker path work without the operator guessing.
    expect(resolveListenTarget(undefined, '0.0.0.0')).toEqual({
      host: '0.0.0.0',
      source: 'env',
    })
  })

  it('test_config_outranks_the_environment', () => {
    // A value written into the project is a decision; an environment variable is
    // a deployment detail. The decision wins.
    expect(resolveListenTarget('127.0.0.1', '0.0.0.0')).toEqual({
      host: '127.0.0.1',
      source: 'config',
    })
    expect(resolveListenTarget(true, '127.0.0.1')).toEqual({ host: '0.0.0.0', source: 'config' })
  })

  it('test_host_false_is_an_explicit_refusal_and_outranks_HOST', () => {
    // `host: false` is somebody writing down "do not open me up". An environment
    // variable must not quietly overrule that.
    expect(resolveListenTarget(false, '0.0.0.0')).toEqual({ host: 'localhost', source: 'default' })
  })

  it('test_absent_everywhere_is_still_the_loopback', () => {
    // Unchanged, and deliberately: binding every interface is a decision someone
    // should have to write down.
    expect(resolveListenTarget(undefined)).toEqual({
      host: 'localhost',
      source: 'default',
    })
    expect(resolveListenTarget(undefined, '')).toEqual({ host: 'localhost', source: 'default' })
  })

  it('test_the_two_opposite_states_do_not_print_the_same_line', () => {
    const everyInterface = describeListenTarget({ host: '0.0.0.0', source: 'env' }, 3000)
    const thisMachineOnly = describeListenTarget({ host: 'localhost', source: 'default' }, 3000)

    // The regression in one assertion: these used to be identical.
    expect(everyInterface).not.toBe(thisMachineOnly)
    expect(everyInterface).toContain('every interface')
    expect(thisMachineOnly).toContain('localhost only')
  })

  it('test_the_default_line_names_what_to_do_about_it', () => {
    // The fifth metric of the benchmark: when it will not do what you wanted,
    // the message names the action. An operator reading this in a container log
    // should not have to find out by curling.
    const line = describeListenTarget({ host: 'localhost', source: 'default' }, 3000)

    expect(line).toContain('host: true')
    expect(line).toContain('HOST=0.0.0.0')
  })

  it('test_an_unopenable_bind_address_is_still_offered_as_a_url', () => {
    // `0.0.0.0` and `::` are not addresses a human can click.
    expect(describeListenTarget({ host: '0.0.0.0', source: 'env' }, 8080)).toContain(
      'http://localhost:8080',
    )
    expect(describeListenTarget({ host: '::', source: 'config' }, 8080)).toContain(
      'http://localhost:8080',
    )
  })
})
