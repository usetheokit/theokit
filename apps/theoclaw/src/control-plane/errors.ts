/**
 * The two refusals the control plane makes before it opens anything. Each carries the field a
 * caller reads instead of parsing the message, and no message ever carries a secret or the value
 * that was refused.
 */

/** A configuration value is missing or malformed. `variable` names the environment variable. */
export class TheoClawConfigError extends Error {
  readonly variable: string | undefined

  // The message-only call stays valid because B-369's branch declares its own TheoClawConfigError in
  // `src/channels/output-mask.ts` and constructs it with a message alone. A rebase keeps both
  // declarations; whoever lands second deletes one by hand, or `instanceof` fails across them.
  constructor(message: string, options: { readonly variable?: string } = {}) {
    super(message)
    this.name = 'TheoClawConfigError'
    this.variable = options.variable
  }
}

/** The control plane cannot bind: a public address without the confirmation, or the socket refused. */
export class TheoClawBindError extends Error {
  readonly address: string | undefined
  readonly port: number | undefined

  constructor(message: string, options: { readonly address?: string; readonly port?: number } = {}) {
    super(message)
    this.name = 'TheoClawBindError'
    this.address = options.address
    this.port = options.port
  }
}
