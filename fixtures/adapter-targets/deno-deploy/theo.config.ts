import { config } from 'theokit'

// pnpm theokit build --target=deno-deploy
// Emits .theo/deno/server.ts with Deno.serve and npm: specifiers.
export default config().build()
