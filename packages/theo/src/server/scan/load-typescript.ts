import { createRequire } from 'node:module'

import type * as TS from 'typescript'

/**
 * Load the TypeScript compiler for the AST detectors. `typescript` is an optional peer of
 * `theokit`, so an app without it gets an error naming the package and the install command rather
 * than a bare module-not-found.
 */
export function loadTypescript(): typeof TS {
  try {
    return createRequire(import.meta.url)('typescript') as typeof TS
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'MODULE_NOT_FOUND') {
      throw new Error(
        'theokit needs "typescript" to scan your routes, and it is not installed. ' +
          'Install it with: npm install --save-dev typescript',
      )
    }
    throw err
  }
}
