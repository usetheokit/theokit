import { createRequire } from 'node:module'

import type * as TS from 'typescript'

let compiler: typeof TS | undefined

/** Load `typescript` on first use; it is an optional peer, so say so clearly when it is missing. */
export function loadTypescript(): typeof TS {
  if (compiler) return compiler
  try {
    compiler = createRequire(import.meta.url)('typescript') as typeof TS
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'MODULE_NOT_FOUND') throw err
    throw new Error(
      'theokit needs "typescript" to scan your routes, and it is not installed. ' +
        'Install it with: npm install --save-dev typescript',
    )
  }
  return compiler
}
