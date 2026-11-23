/**
 * The globalSetup of `npm run test:live` (B-407, B-415): under `THEOKIT_LIVE_REQUIRED=1` an absent
 * provider key fails the run instead of letting the A2A real-model test skip green. Without the
 * flag it returns, so a developer with no key keeps the skip the test file applies.
 *
 * The guard is the one `@theokit/agents/testing` publishes; this file only re-exports it as the
 * setup vitest loads.
 */
import { requireProviderKeySetup } from '@theokit/agents/testing'

export { MissingProviderKeyError, assertProviderKeyWhenRequired } from '@theokit/agents/testing'

export default requireProviderKeySetup()
