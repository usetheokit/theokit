import { chmod, rm, writeFile } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'

import { TheokitAgentError } from '@theokit/sdk/errors'

/**
 * Thrown when a bundle is refused. The message names the file, never the secret.
 * `secret_survived`: a configured secret is still in a file after the mask.
 * `name_too_long`: a file name exceeds the 100 bytes a ustar header holds.
 */
export class DiagnosticBundleError extends TheokitAgentError {
  override readonly name = 'DiagnosticBundleError'
  readonly reason: 'secret_survived' | 'name_too_long'
  constructor(reason: 'secret_survived' | 'name_too_long', message: string) {
    super(message, { code: `DIAGNOSTIC_BUNDLE_${reason.toUpperCase()}`, isRetryable: false })
    this.reason = reason
  }
}

export interface WriteDiagnosticBundleOptions {
  /** Path of the `.tar.gz` to write, mode 0600. */
  out: string
  /** File names are limited to 100 bytes (UTF-8). */
  files: readonly { name: string; content: string }[]
  /** Values that must not appear in any file. Empty strings are ignored. */
  secrets: readonly string[]
  /** Applied to every content before the check and before writing. */
  mask?: (text: string) => string
}

const NAME_BYTES = 100

function tarHeader(name: string, size: number): Buffer {
  const header = Buffer.alloc(512)
  header.write(name, 0, NAME_BYTES, 'utf8')
  header.write('0000600\0', 100, 'ascii')
  header.write('0000000\0', 108, 'ascii')
  header.write('0000000\0', 116, 'ascii')
  header.write(size.toString(8).padStart(11, '0') + '\0', 124, 'ascii')
  header.write(
    Math.floor(Date.now() / 1000)
      .toString(8)
      .padStart(11, '0') + '\0',
    136,
    'ascii',
  )
  header.fill(0x20, 148, 156)
  header.write('0', 156, 'ascii')
  header.write('ustar\0', 257, 'ascii')
  header.write('00', 263, 'ascii')
  let sum = 0
  for (const byte of header) sum += byte
  header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 'ascii')
  return header
}

function redact(text: string, secrets: readonly string[]): string {
  let out = text
  for (const s of secrets) out = out.split(s).join('[redacted]')
  return out
}

/**
 * Writes a gzip'd ustar archive of `files`, after masking each content, and refuses to write
 * anything when a configured secret is still present in a masked content or a file name.
 */
export async function writeDiagnosticBundle(
  options: WriteDiagnosticBundleOptions,
): Promise<{ path: string; bytes: number }> {
  const secrets = options.secrets.filter((s) => s.length > 0)
  const mask = options.mask ?? ((t: string) => t)
  const blocks: Buffer[] = []
  for (const file of options.files) {
    const shown = redact(file.name, secrets)
    if (Buffer.byteLength(file.name, 'utf8') > NAME_BYTES) {
      throw new DiagnosticBundleError(
        'name_too_long',
        `Diagnostic bundle file name "${shown}" is longer than ${NAME_BYTES} bytes.`,
      )
    }
    const content = mask(file.content)
    if (secrets.some((s) => content.includes(s) || file.name.includes(s))) {
      throw new DiagnosticBundleError(
        'secret_survived',
        `Diagnostic bundle refused: a configured secret survived in "${shown}".`,
      )
    }
    const body = Buffer.from(content, 'utf8')
    blocks.push(tarHeader(file.name, body.length), body)
    const pad = (512 - (body.length % 512)) % 512
    if (pad > 0) blocks.push(Buffer.alloc(pad))
  }
  blocks.push(Buffer.alloc(1024))
  const gz = gzipSync(Buffer.concat(blocks))
  await rm(options.out, { force: true })
  await writeFile(options.out, gz, { mode: 0o600 })
  if (process.platform !== 'win32') await chmod(options.out, 0o600)
  return { path: options.out, bytes: gz.length }
}
