import { parseArgs } from 'node:util'

import { describeError } from './control-plane/errors.js'
import type { OnboardOptions } from './onboard.js'

/** The flags of `theoclaw onboard` and `theoclaw update` (B-374), read strictly. */

/** Bad usage: the command line itself is wrong, which is exit 2 rather than a refusal. */
export class UsageError extends Error {}

export function parseOnboard(args: readonly string[]): OnboardOptions {
  let values
  try {
    ;({ values } = parseArgs({
      args: [...args],
      strict: true,
      allowPositionals: false,
      options: {
        yes: { type: 'boolean' },
        force: { type: 'boolean' },
        model: { type: 'string' },
        'api-key-env': { type: 'string' },
        port: { type: 'string' },
        owners: { type: 'string' },
        workspace: { type: 'string' },
      },
    }))
  } catch (error) {
    throw new UsageError(`theoclaw onboard: ${describeError(error)}`)
  }
  return {
    yes: values.yes === true,
    force: values.force === true,
    model: values.model,
    apiKeyEnv: values['api-key-env'],
    port: values.port,
    owners: values.owners,
    workspace: values.workspace,
  }
}

export function parseUpdate(args: readonly string[]): { channel?: string } {
  try {
    const { values } = parseArgs({ args: [...args], strict: true, allowPositionals: false, options: { channel: { type: 'string' } } })
    return { channel: values.channel }
  } catch (error) {
    throw new UsageError(`theoclaw update: ${describeError(error)}`)
  }
}
