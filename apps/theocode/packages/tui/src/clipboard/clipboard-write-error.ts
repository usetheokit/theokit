/**
 * B-075 — a clipboard that IS installed and refused the text.
 *
 * Distinct from `NoClipboardError`: reporting absence when this happened sends the user to install
 * something they already have.
 */
import { TheokitAgentError } from '@theokit/agents'

export class ClipboardWriteError extends TheokitAgentError {
  override readonly name = 'ClipboardWriteError'
  readonly bin: string

  constructor(bin: string, detail: string) {
    super(`${bin} failed to take the text: ${detail}`)
    this.bin = bin
  }
}
