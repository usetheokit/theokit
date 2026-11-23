import { GenerationFileError, jsonGenerations, memoryGenerations } from '@theokit/sdk'
import type { GenerationStore } from '@theokit/sdk'

import { TheoClawConfigError } from '../control-plane/errors.js'

/** Say what the SDK's refusal of `sessions.json` means to an operator of TheoClaw. */
function configError(error: GenerationFileError): TheoClawConfigError {
  const code = (error.cause as NodeJS.ErrnoException | undefined)?.code
  if (error.message.endsWith(': unreadable')) {
    return new TheoClawConfigError(`${error.file} cannot be read (${code ?? 'unknown error'})`, { variable: 'THEOCLAW_WORKSPACE' })
  }
  return new TheoClawConfigError(`${error.file} is not a sessions file TheoClaw wrote; move it aside to start every conversation afresh`, {
    variable: 'THEOCLAW_WORKSPACE',
  })
}

/**
 * The generation of each session key: `/new` and `/reset` move a key to its next generation, and
 * the agent id embeds it, so a reset is a new agent id with an empty history (plan D3). An unseen
 * key is at generation 0. The file format, the 0600 mode and the one-write-at-a-time rule are the
 * SDK's `jsonGenerations`; this class only turns its refusal into a `TheoClawConfigError`.
 */
export class Generations implements GenerationStore {
  readonly #store: GenerationStore

  constructor(store: GenerationStore = memoryGenerations()) {
    this.#store = store
  }

  /**
   * The generations stored in `file`, or none when it does not exist. A file that is not a
   * generations file is refused with a `TheoClawConfigError` naming it, and left as it is.
   */
  static load(file: string): Generations {
    try {
      return new Generations(jsonGenerations(file))
    } catch (error) {
      if (error instanceof GenerationFileError) throw configError(error)
      throw error
    }
  }

  current(key: string): number {
    return this.#store.current(key)
  }

  /** Move `key` to its next generation; a write that fails leaves the generation where it was. */
  next(key: string): Promise<number> {
    return this.#store.next(key)
  }
}
