import { afterEach } from 'vitest'

import { closeOpenForwards } from './ssh-forward.js'

/**
 * Close every SSH forward a test left open, whether it passed or threw (EC-1). The one support
 * module that imports vitest, so `ssh-forward.ts` stays Node built-ins only. The hook carries its
 * own 60000 ms timeout, so it holds whatever order the `describe` declares things in.
 */
export function useForwardCleanup(): void {
  afterEach(closeOpenForwards, 60_000)
}
