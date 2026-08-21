/**
 * Moved to `core/contracts/nonce.ts` — see that file for why.
 *
 * Re-exported here so every existing import path (including
 * `server/internal-api.ts`, which publishes it) keeps working.
 */
export { generateNonce } from '../../core/contracts/nonce.js'
