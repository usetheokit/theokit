import { describe, expect, it } from 'vitest'

import { transformControllerSource } from '../../src/bridge/swc-loader.js'
import { HttpDecoratorsConfigError } from '../../src/index.js'

/**
 * #1086 — without @swc/core the error blamed parameter decorators and told every reader to run
 * `pnpm add -D @swc/core`. Every controller goes through SWC, decorators or not, and a scaffold
 * installed with npm or yarn should not be sent to pnpm. @theokit/http cannot read the project's
 * lockfile through theokit (theokit depends on this package), so the message names the package.
 */
const CONTROLLER_WITHOUT_PARAMETER_DECORATORS =
  '@Controller() export class Users { @Get() list() { return [] } }'

async function errorWithoutSwc(): Promise<Error> {
  try {
    await transformControllerSource(
      CONTROLLER_WITHOUT_PARAMETER_DECORATORS,
      '/app/src/server/controllers/users.controller.ts',
      async () => null,
    )
  } catch (err) {
    return err as Error
  }
  throw new Error('transformControllerSource did not throw without @swc/core')
}

describe('the error when @swc/core is missing', () => {
  it('is a typed configuration error', async () => {
    expect(await errorWithoutSwc()).toBeInstanceOf(HttpDecoratorsConfigError)
  })

  it('says every controller needs @swc/core, not only parameter decorators', async () => {
    const { message } = await errorWithoutSwc()
    expect(message).toContain('@swc/core')
    expect(message).toMatch(/every controller/i)
    expect(message).not.toMatch(/required for parameter decorators/)
  })

  it('names the dev dependency without prescribing a package manager', async () => {
    const { message } = await errorWithoutSwc()
    expect(message).toMatch(/dev dependency/i)
    expect(message).not.toMatch(/\b(pnpm|npm|yarn|bun) (add|install|i)\b/)
  })
})
