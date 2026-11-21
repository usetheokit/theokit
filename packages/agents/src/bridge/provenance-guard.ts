import type { Plugin, PreToolCallContext } from '@theokit/sdk'

export interface ProvenanceGuardOptions {
  /**
   * The tools whose output is text a third party wrote: a list of names, or a predicate.
   * Default: `web_fetch`, `web_search` and every tool whose name starts with `mcp_`.
   * These tools are never blocked, so a search followed by a fetch of a result's URL still runs.
   */
  readonly untrustedSources?: readonly string[] | ((toolName: string) => boolean)
  /** The shortest run of characters taken as a copied value. Default 8. */
  readonly minRun?: number
  /** How many texts each list (untrusted, trusted) keeps; the oldest are dropped. Default 50. */
  readonly keep?: number
  /** The text of the refusal, given the tool and the offending run. */
  readonly message?: (toolName: string, run: string) => string
}

type GeneralPlugin = Extract<Plugin, { kind: 'general' }>

const DEFAULT_SOURCES: ReadonlySet<string> = new Set(['web_fetch', 'web_search'])

function stringsIn(value: unknown, into: string[] = []): string[] {
  if (typeof value === 'string') into.push(value)
  else if (Array.isArray(value)) for (const item of value) stringsIn(item, into)
  else if (typeof value === 'object' && value !== null)
    for (const item of Object.values(value)) stringsIn(item, into)
  return into
}

/** A plain lowercase word is prose, not a copied value; ids, tokens and URLs are not. */
function looksLikeValue(run: string): boolean {
  return /[^a-z]/i.test(run) && /[0-9_\-.:/@#+=%]/.test(run)
}

function untrustedPredicate(
  source: ProvenanceGuardOptions['untrustedSources'],
): (name: string) => boolean {
  if (typeof source === 'function') return source
  if (source !== undefined) return (name) => source.includes(name)
  return (name) => DEFAULT_SOURCES.has(name) || name.startsWith('mcp_')
}

function positiveInt(name: string, value: number, min: number): number {
  if (!Number.isInteger(value) || value < min) {
    throw new RangeError(`createProvenanceGuard: ${name} must be an integer >= ${String(min)}`)
  }
  return value
}

/**
 * A plugin that refuses a tool call carrying a value the agent only saw in untrusted tool output.
 *
 * On `post_tool_call` it remembers the output (`result.stdout`) of untrusted tools as untrusted and
 * that of every other tool as trusted; on `pre_user_send` it remembers the person's message as
 * trusted. On `pre_tool_call` it scans every string in the arguments (nested objects and arrays
 * included) for runs of `minRun`+ characters from `[A-Za-z0-9_\-.:/@#+=%]` that contain a digit or
 * punctuation, and blocks the call when such a run appears in an untrusted output and in no trusted
 * text. The system prompt is not visible to a plugin.
 *
 * **State is per instance.** The remembered texts live in the returned plugin, so one instance
 * shared by several agents or sessions mixes their conversations. Create one per agent or session.
 *
 * Blind spots, by design: a value shorter than `minRun`, a plain lowercase word, or a value the
 * model reformatted is not checked, and only the last `keep` texts of each kind are remembered.
 */
export function createProvenanceGuard(options: ProvenanceGuardOptions = {}): GeneralPlugin {
  const minRun = positiveInt('minRun', options.minRun ?? 8, 1)
  const keep = positiveInt('keep', options.keep ?? 50, 0)
  const isUntrusted = untrustedPredicate(options.untrustedSources)
  const message =
    options.message ??
    ((tool, run) =>
      `${tool} was not run: its argument "${run}" appears only in output of an untrusted tool, not in anything the user said. Ask the user to confirm before using it.`)
  // eslint-disable-next-line security/detect-non-literal-regexp -- minRun is a validated integer
  const run = new RegExp(`[A-Za-z0-9_\\-.:/@#+=%]{${String(minRun)},}`, 'g')

  const untrusted: string[] = []
  const trusted: string[] = []
  const remember = (list: string[], text: string): void => {
    list.push(text)
    while (list.length > keep) list.shift()
  }

  return {
    kind: 'general',
    name: 'theokit-provenance-guard',
    version: '1.0.0',
    register: (ctx) => {
      ctx.on('pre_user_send', (context: unknown) => {
        const prompt = (context as { prompt?: unknown } | undefined)?.prompt
        if (typeof prompt === 'string') remember(trusted, prompt)
        return undefined
      })
      ctx.on('post_tool_call', (context: unknown) => {
        const done = (context ?? {}) as { name?: unknown; result?: { stdout?: unknown } }
        if (typeof done.name !== 'string') return undefined
        const out = done.result?.stdout
        remember(
          isUntrusted(done.name) ? untrusted : trusted,
          typeof out === 'string' ? out : JSON.stringify(out ?? ''),
        )
        return undefined
      })
      ctx.on('pre_tool_call', (context: unknown) => {
        const call = (context ?? {}) as Partial<PreToolCallContext>
        if (call.name === undefined || isUntrusted(call.name) || untrusted.length === 0) {
          return undefined
        }
        for (const text of stringsIn(call.args)) {
          for (const [found] of text.matchAll(run)) {
            if (!looksLikeValue(found)) continue
            if (
              untrusted.some((s) => s.includes(found)) &&
              !trusted.some((s) => s.includes(found))
            ) {
              return { block: true, message: message(call.name, found) }
            }
          }
        }
        return undefined
      })
    },
  }
}
