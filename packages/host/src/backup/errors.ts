import { HostError } from '../host-error.js'

/** Thrown by `backup` and `restore`. `path` names the offending file or directory when there is one. */
export class BackupError extends HostError {
  readonly path?: string

  constructor(message: string, options?: { path?: string; cause?: unknown }) {
    super(
      'host_backup',
      message,
      options?.cause === undefined ? undefined : { cause: options.cause },
    )
    this.name = 'BackupError'
    if (options?.path !== undefined) this.path = options.path
  }
}
