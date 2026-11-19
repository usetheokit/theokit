/**
 * The live suite's globalSetup. The guard now lives in the published `@theokit/agents/testing`
 * entry; this file keeps the existing import paths and `vitest.live.config.ts` working.
 */
import { requireProviderKeySetup } from '../../src/testing/provider-key.js'

export {
  LIVE_KEY_NAMES,
  MissingProviderKeyError,
  assertProviderKeyWhenRequired,
} from '../../src/testing/provider-key.js'

export default requireProviderKeySetup()
