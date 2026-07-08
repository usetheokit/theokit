import { config } from 'theokit'

// pnpm theokit build --target=netlify
// Emits .netlify/functions/theo.mjs and merges netlify.toml non-destructively.
export default config().build()
