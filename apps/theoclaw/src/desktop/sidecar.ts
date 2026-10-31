import { runWithOutputMask } from '../control-client/masked-entry.js'
import { resolveModelKey } from '../control-plane/settings.js'
import { runDesktopSidecar } from './run-sidecar.js'

/**
 * `theoclaw-desktop-sidecar`: the process the desktop shell spawns per turn. Its output runs through
 * the exact-value mask, so neither the control token nor the model key reaches the shell (NFR-002).
 */
const env = process.env
const secrets = [env.THEOCLAW_CONTROL_TOKEN ?? '', resolveModelKey(env) ?? '']
process.exitCode = await runWithOutputMask(secrets, () =>
  runDesktopSidecar({ argv: process.argv, env, stdout: (line) => void process.stdout.write(line) }),
)
