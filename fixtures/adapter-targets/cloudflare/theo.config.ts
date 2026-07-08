import { config } from 'theokit'

// pnpm theokit build --target=cloudflare
// Emits .theo/cloudflare/worker.mjs (Workers entry).
export default config().build()
