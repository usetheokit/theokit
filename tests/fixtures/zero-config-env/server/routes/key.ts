import { route } from 'theokit/server'

/**
 * Test endpoint for T1.2 — exposes whether process.env.OPENROUTER_API_KEY
 * was populated by the framework's auto-load. Used in
 * tests/unit/cli-env-wiring.test.ts.
 */
export const GET = route()
  // Public because this fixture exists to prove the env auto-load ran, and the
  // values it reports are fixture values. A route shaped like this in a real app
  // would not be public: it reads process env into a response body.
  .policy('public')
  .handler(() => {
    return {
      openRouterKey: process.env.OPENROUTER_API_KEY ?? null,
      fixtureVar: process.env.ZERO_CONFIG_FIXTURE_VAR ?? null,
    }
  })
  .build()
