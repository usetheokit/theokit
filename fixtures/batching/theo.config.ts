import { config } from 'theokit'

// Enable the built-in client batcher: same-microtask theoFetch calls
// collapse into a single POST /api/__theo_batch__ request.
export default config().set({ batching: true }).build()
