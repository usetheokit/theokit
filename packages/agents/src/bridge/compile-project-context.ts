/**
 * M8-2 — compile `@ProjectContext` metadata into an SDK `SystemPromptResolver`.
 *
 * There is no native `AgentOptions` field that carries a repo map, so the bridge
 * composes the documented `systemPrompt` seam (`string | SystemPromptResolver`):
 * the resolver prepends `buildEnvContext` + `buildRepoMap` (`@theokit/sdk-tools`)
 * and the nearest `THEO.md` (`@theokit/sdk/project#readProjectInstructions`) to
 * the agent's base prompt (ADR D3). The SDK primitives are dynamically imported
 * so `@theokit/sdk-tools` stays an OPTIONAL peer — only loaded when a `@ProjectContext`
 * agent actually sends.
 *
 * Knobs with no primitive mapping (`indexStrategy`, `relevanceStrategy`,
 * `maxFilesInContext`, `includeExtensions`, `rootMarkers`) are reported via
 * {@link projectContextMetadataOnlyKnobs} so the walk warns honestly (G10).
 * Only `ignorePatterns` is forwarded (to `buildRepoMap`).
 */
import type { SystemPromptResolver } from '@theokit/sdk'

import type { ProjectContextOptions } from '../decorators/project-context.js'

/** `@ProjectContext` knobs with no primitive mapping (reported, not executed). */
const UNMAPPED_KNOBS = [
  'indexStrategy',
  'relevanceStrategy',
  'maxFilesInContext',
  'includeExtensions',
  'rootMarkers',
] as const

export function projectContextMetadataOnlyKnobs(options: ProjectContextOptions): string[] {
  const opts = options as Record<string, unknown>
  return UNMAPPED_KNOBS.filter((knob) => opts[knob] !== undefined)
}

/**
 * Build a `SystemPromptResolver` that prepends env + repo map + project
 * instructions to `base`. `base` may itself be a {@link SystemPromptResolver}
 * (V4-L.1, ADR D2): it is resolved once with the same `promptCtx` and composed
 * (resolve-then-prepend). A failing base resolver propagates (fail-loud). When the
 * SDK provides no `cwd`, the resolver returns the resolved base unchanged (no
 * filesystem guess — keeps `packages/agents/src` free of direct Node `process`
 * access per G8; the repo map needs a real cwd).
 */
export function compileProjectContext(
  options: ProjectContextOptions,
  base?: string | SystemPromptResolver,
): SystemPromptResolver {
  return async (promptCtx) => {
    const resolvedBase = typeof base === 'function' ? await base(promptCtx) : base
    const cwd = promptCtx.cwd
    if (!cwd) {
      return resolvedBase ?? ''
    }

    const { buildEnvContext, buildRepoMap } = await import('@theokit/sdk-tools')
    const { readProjectInstructions } = await import('@theokit/sdk/project')

    const env = buildEnvContext(cwd)
    const repoMap = buildRepoMap(cwd, { ignore: options.ignorePatterns })

    let instructions = ''
    try {
      instructions = (await readProjectInstructions(cwd)).content ?? ''
    } catch {
      // readProjectInstructions is best-effort: a missing/unreadable THEO.md must
      // never break a send. buildEnvContext/buildRepoMap are never-throw by contract.
      instructions = ''
    }

    return [env, repoMap, instructions, resolvedBase].filter(Boolean).join('\n\n')
  }
}
