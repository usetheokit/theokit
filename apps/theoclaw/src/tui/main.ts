import { render } from 'ink'
import { createElement } from 'react'

import { createControlClient } from '../control-client/control-client.js'
import { runWithOutputMask } from '../control-client/masked-entry.js'
import { readControlClientSettings } from '../control-client/settings.js'
import { describeError } from '../control-plane/errors.js'
import { resolveModelKey } from '../control-plane/settings.js'
import { TheoClawTui } from './app.js'

/**
 * `theoclaw-tui`: connect to the running instance and render the TUI on this terminal. Its output
 * runs through the exact-value mask, so neither the control token nor the model key is drawn
 * (NFR-002). Exits 1 with one line when the settings or the connection fail.
 */
async function main(): Promise<number> {
  let client
  let settings
  try {
    settings = readControlClientSettings(process.env)
    client = await createControlClient(settings)
  } catch (error) {
    process.stderr.write(`theoclaw-tui: ${describeError(error)}\n`)
    return 1
  }
  const app = render(createElement(TheoClawTui, { client, session: settings.session, onExit: () => app.unmount() }))
  await app.waitUntilExit()
  return 0
}

const secrets = [process.env.THEOCLAW_CONTROL_TOKEN ?? '', resolveModelKey(process.env) ?? '']
process.exitCode = await runWithOutputMask(secrets, main)
