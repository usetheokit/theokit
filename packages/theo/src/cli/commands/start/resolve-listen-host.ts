/**
 * Resolve the address `server.listen` should bind, and say which it is.
 *
 * `config.host` was declared, defaulted to `'localhost'`, documented as the way to
 * open a server to the LAN, and never passed to `listen`. Node with no address
 * binds EVERY interface, so the production server listened wider than its
 * configuration said — and its default said the narrow thing.
 *
 * Fixing that broke containers, which is the second half of this story
 * (usetheokit/theokit#402). Inside a container `localhost` means *nobody*: the
 * image starts, prints a URL, and refuses every request including its own. So the
 * environment gets a say. `HOST` is the variable every container platform already
 * sets or expects to set, and honouring it costs the operator nothing to discover.
 *
 * Precedence, narrowest authority last: explicit config beats `HOST`, because a
 * value written into the project is a decision and an environment variable is a
 * deployment detail. Absent both, the loopback — binding every interface is a
 * decision someone should have to write down.
 *
 * The second export exists because the log lied. `theo start` printed `localhost`
 * whether it bound the loopback or every interface, so a container that serves
 * everyone and a container that serves nobody produced byte-identical output.
 * That is `docs/adr/0002-an-abnormal-ending-is-never-reported-as-normal.md` in the
 * startup path: the observable state must distinguish the two.
 */

export interface ListenTarget {
  /** The address handed to `server.listen`. */
  readonly host: string
  /** Where the value came from, so the log can say so rather than guess. */
  readonly source: 'config' | 'env' | 'default'
}

export function resolveListenTarget(
  host: string | boolean | undefined,
  env: string | undefined = process.env.HOST,
): ListenTarget {
  if (host === true) return { host: '0.0.0.0', source: 'config' }
  if (typeof host === 'string' && host !== '') return { host, source: 'config' }
  // `host: false` is an explicit "do not open me up" and outranks the environment.
  if (host !== false && env !== undefined && env !== '') return { host: env, source: 'env' }
  return { host: 'localhost', source: 'default' }
}

/**
 * The line `theo start` prints, given what it actually bound.
 *
 * `0.0.0.0` is not a URL a human can open, so the loopback is offered — but the
 * bound address is stated beside it, because "every interface" and "this machine
 * only" are the two states an operator most needs to tell apart, and they were
 * indistinguishable.
 */
export function describeListenTarget(target: ListenTarget, port: number): string {
  const url = target.host === '0.0.0.0' || target.host === '::' ? 'localhost' : target.host
  const bound =
    target.host === '0.0.0.0' || target.host === '::'
      ? `bound to ${target.host} (every interface)`
      : `bound to ${target.host} only`
  return `  → http://${url}:${String(port)}  [${bound}${provenance(target.source)}]`
}

/** Where the address came from, and — when nobody chose it — what to write to change it. */
function provenance(source: ListenTarget['source']): string {
  if (source === 'env') return ' from HOST'
  if (source === 'config') return ''
  return ' — set `host: true` in theo.config.ts or HOST=0.0.0.0 to reach it from outside this machine'
}
