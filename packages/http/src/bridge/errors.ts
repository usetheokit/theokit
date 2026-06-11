/**
 * Configuration error thrown by the bridge when decorator setup is incomplete.
 * Carries actionable messages pointing consumers to the migration guide.
 */
export class HttpDecoratorsConfigError extends Error {
  override readonly name = 'HttpDecoratorsConfigError'

  constructor(message: string) {
    super(message)
  }
}
