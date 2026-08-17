import { action, ActionError } from 'theokit/server'
import { z } from 'zod'

// Scenario 5 — handler throws a domain ActionError. The runtime maps the
// FORBIDDEN code to HTTP 403 and emits the flat `TheoActionError` envelope.
export const denyAlways = action()
  .input(z.object({}))
  .handler(() => {
    throw new ActionError({ code: 'FORBIDDEN', message: 'Access denied' })
  })
  .build()
