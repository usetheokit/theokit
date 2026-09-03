import { config } from 'theokit'

/**
 * The project has two surfaces, and one of them is the whole backend.
 *
 * `src/app` is the interface. `src/server` is everything that only runs on the server — and agents
 * are part of that, not a third surface beside it. An agent shares this project's context, auth,
 * services and infrastructure with every controller and route; a layout that puts `agents/` beside
 * `server/` suggests two backends and invites both to grow their own copy of all four.
 *
 * The paths are declared rather than inherited. The defaults are still the flat layout
 * (`app`, `server`, `agents`), so a project that says nothing keeps working exactly as before —
 * writing them down is what lets this scaffold move without waiting for a major, and what stops a
 * future default change from silently relocating anyone's code.
 */
export default config()
  .appDir('src/app')
  .serverDir('src/server')
  .agentsDir('src/server/agents')
  .build()
