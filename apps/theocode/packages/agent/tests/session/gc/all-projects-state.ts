/** The fakes the all-projects GC tests steer. Import-free on purpose: `vi.mock` factories load it. */
export const state = {
  registry: new Map<string, { agentId: string; archived?: boolean; lastModified?: number }[]>(),
  failRegistry: new Set<string>(),
  writers: new Set<string>(),
}
