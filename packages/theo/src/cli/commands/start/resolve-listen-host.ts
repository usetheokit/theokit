/**
 * Resolve `config.host` into the address `server.listen` should bind.
 *
 * `config.host` was declared, defaulted to `'localhost'`, documented as the way to
 * open a server to the LAN, and never passed to `listen`. Node with no address
 * binds EVERY interface, so the production server listened wider than its
 * configuration said — and its default said the narrow thing.
 *
 * The boolean form is what the schema's own comment describes: "Listen on all
 * addresses (0.0.0.0) for LAN/mobile testing". A string is used verbatim, because
 * an operator naming an address means that address.
 *
 * Absent resolves to the loopback rather than to everything. Narrow is the safe
 * choice to make silently; binding every interface is a decision someone should
 * have to write down.
 */
export function resolveListenHost(host: string | boolean | undefined): string {
  if (host === true) return '0.0.0.0'
  if (host === false || host === undefined) return 'localhost'
  return host
}
