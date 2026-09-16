import { Agent, TheokitAgentError } from '@theokit/agents'

interface ListedAgent {
  agentId: string
  name?: string
  archived?: boolean
  lastModified?: number
  cwd?: string
}

type RawListing = (cwd: string) => Promise<{ items: ListedAgent[]; nextCursor?: string }>

export class CursorNotDrainedError extends TheokitAgentError {
  readonly name = 'CursorNotDrainedError'
  readonly cursor: string

  constructor(cursor: string) {
    super(
      `the agent listing returned a cursor (${cursor}) this version cannot drain — ` +
        `refusing to return a partial page, because the caller would use it as the complete population`,
    )
    this.cursor = cursor
  }
}

/**
 * B-020 — this listing CANNOT produce a cursor, and that is the SDK's guarantee rather than an
 * omission here.
 *
 * `@theokit/agents` narrows `Agent.list` to a non-paginated overload (`ListOptionsWithoutPagination`:
 * `limit?: never; cursor?: never`) whose return type is `Omit<ListResult, 'nextCursor'>`. There is
 * no cursor to forward, and asking for a page is a type error.
 *
 * The B-012 finding read this as "the guard was defeated by dropping a field". Measured against the
 * SDK's declaration, that is wrong: the field does not exist on this surface. Forwarding it would
 * have been inventing one.
 *
 * `CursorNotDrainedError` therefore cannot fire through this path today. It is kept — rather than
 * deleted as dead — because it is a tripwire on an SDK UPGRADE: the moment that narrowing is lifted,
 * a paginated reply starts truncating a set that guards DELETION (the GC builds its protection set
 * from this listing), and the guard turns a silent truncation into a refusal. What it must not do is
 * read as live protection, which is what this comment is for.
 */
const defaultListing: RawListing = async (cwd) => {
  const r = await Agent.list({ runtime: 'local', cwd })
  return { items: r.items }
}

export async function listAgents(
  cwd: string,
  list: RawListing = defaultListing,
): Promise<ListedAgent[]> {
  const r = await list(cwd)
  if (r.nextCursor !== undefined) throw new CursorNotDrainedError(r.nextCursor)
  return r.items
}
