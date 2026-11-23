import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

import { quote } from './pty-owner.js'
import type { OwnedPtyBackend } from './pty-owner.js'

type ProbeBackend = Pick<OwnedPtyBackend, 'startInteractive' | 'writeStdin' | 'kill'>

/**
 * True when a real session started through `backend` writes inside `root` and is refused a write
 * outside it (a unique sibling of `root`). False on any failure: no PTY, a timeout, output that does
 * not show the outside write was attempted and refused, or an outside file that exists. Both probe
 * files and the session are removed afterwards.
 */
export async function probeConfinement(
  backend: ProbeBackend,
  root: string,
  timeoutMs = 5000,
): Promise<boolean> {
  const id = randomBytes(6).toString('hex')
  const inside = join(root, `.probe-in-${id}`)
  const outside = join(dirname(root), `.probe-out-${basename(root)}-${id}`)
  const done = `probe-done-${id}`
  const refused = `probe-refused-${id}`
  let session: string | undefined
  try {
    mkdirSync(root, { recursive: true })
    const script = `touch ${quote(inside)}; if touch ${quote(outside)} 2>/dev/null; then echo wrote-${id}; else echo ${refused}; fi; echo ${done}`
    const started = await backend.startInteractive(`sh -c ${quote(script)}`, { yieldMs: 250 })
    session = started.sessionId
    let output = started.output
    const deadline = Date.now() + timeoutMs
    let alive = true
    while (!output.includes(done) && alive && Date.now() < deadline) {
      const next = await backend.writeStdin(session, '', { yieldMs: 250 })
      output += next.output
      alive = next.alive
    }
    return (
      output.includes(done) &&
      output.includes(refused) &&
      existsSync(inside) &&
      !existsSync(outside)
    )
  } catch {
    return false
  } finally {
    if (session !== undefined) {
      try {
        backend.kill(session)
      } catch {
        // already gone
      }
    }
    rmSync(inside, { force: true })
    rmSync(outside, { force: true })
  }
}
