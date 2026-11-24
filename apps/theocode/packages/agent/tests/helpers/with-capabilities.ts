import { applyCapabilities } from '@theokit/agents'

/**
 * The compiled shape of a built agent: what its `.capability()` links contributed, folded over the
 * definition's own fields. The coding preset arrives as a capability, so its tools, approvals and
 * setting sources are not on the definition itself until the framework compiles them.
 */
export function withCapabilities(definition: unknown): Record<string, unknown> {
  const def = definition as Record<string, unknown> & {
    capabilities?: Parameters<typeof applyCapabilities>[0]
    tools?: unknown[]
    approvals?: Record<string, unknown>
  }
  const draft = applyCapabilities(def.capabilities ?? [])
  return {
    ...def,
    tools: [...(def.tools ?? []), ...draft.tools],
    approvals: { ...def.approvals, ...Object.fromEntries(draft.hitl ?? []) },
    settingSources: draft.settingSources ?? def.settingSources,
    compatSources: draft.compatSources ?? def.compatSources,
    hookApproval: draft.hookApproval ?? def.hookApproval,
    withheldBuiltinTools: draft.withheldBuiltinTools ?? def.withheldBuiltinTools,
    offTools: draft.offTools ?? [],
  }
}
