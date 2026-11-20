/** A guard setting that is missing, malformed or unsafe. The message names the variable, never its value. */
export class GuardConfigError extends Error {
  readonly variable: string
  constructor(message: string, variable: string) {
    super(message)
    this.name = 'GuardConfigError'
    this.variable = variable
  }
}

/** A bind address refused because it is not loopback and the owner gave no consent. */
export class BindRefusedError extends Error {
  readonly address: string
  constructor(message: string, address: string) {
    super(message)
    this.name = 'BindRefusedError'
    this.address = address
  }
}
