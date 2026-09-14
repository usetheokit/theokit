/**
 * B-079 + B-080 — the tools through which the agent declares the work it is judged on.
 *
 * ## The half-present feature these close
 *
 * The runtime already models tasks and already emits their lifecycle: `Task.submit` is published and
 * `task_started` / `task_updated` / `task_completed` reach a consumer through `RunEvent`. B-018 even
 * shipped moderation for `task_progress.text`, so the channel is real enough to have needed a
 * security gate.
 *
 * What was missing is the way in. Measured 2026-09-14: `packages/agents/src` emitted `task_started`
 * in **0** files and produced `subgoals` in **0**, against a control of 2 for `GoalOptions`. So
 * `Task.submit` was reachable by the EMBEDDER and by nothing the model could call — a UI could draw
 * a task list the agent had no way to populate.
 *
 * ## Why a declaration is a DEFERRED task, and not a quick one
 *
 * `Task.submit<T>(kind, work, options?)` takes a work FUNCTION: it was designed to RUN work. A
 * declaration has no function — the work is the agent, across turns. So the work this submits
 * returns a promise that stays pending until `task_complete` resolves it.
 *
 * The naive alternative is worth naming because it looks correct: submitting work that returns
 * immediately emits `task_started` and `task_completed` in the same tick. Every declaration would be
 * born finished, and "declared and still open" could never be distinguished from "never declared" —
 * which is the whole point of declaring.
 *
 * ## Two tools rather than one with a verb
 *
 * `task({ action: "declare" | "complete" })` would put the branch inside the handler, where a wrong
 * value is a runtime error the model discovers by failing. Two tools put it in the schema, where the
 * invalid call cannot be expressed.
 */
import { z } from 'zod'

/**
 * The slice of the task registry these tools use.
 *
 * Declared structurally rather than importing `Task` directly, so a test can supply a stub without
 * standing up the SDK's registry — and so this module states exactly which two capabilities it
 * depends on rather than the whole class.
 */
export interface TaskRegistry {
  submit(
    kind: string,
    work: (ctx: { readonly signal: AbortSignal }) => Promise<unknown>,
  ): Promise<{ readonly id: string }>
  readonly resolvers: Map<string, () => void>
}

export interface TaskToolOptions {
  readonly registry: TaskRegistry
  /** Overrides the tool name, for a consumer whose registry already uses it. */
  readonly name?: string
}

/** The declaration tool: one unit of work the agent intends to do. */
export function createTaskDeclareTool(options: TaskToolOptions) {
  const inputSchema = z.object({
    what: z
      .string()
      .min(1)
      .describe(
        'One unit of work you intend to do, stated so somebody else could tell whether it is done.',
      ),
  })

  return {
    name: options.name ?? 'task_declare',
    description:
      "Declare one unit of work you intend to do. It appears in the run's task list immediately and " +
      'stays OPEN until you call task_complete with the id this returns. Declaring is not doing: the ' +
      'declaration is what you will be judged against, so state work you mean to finish. ' +
      'Returns JSON: { ok: true, id } on success, { ok: false, error } when the registry refuses.',
    inputSchema,
    handler: async (raw: unknown): Promise<string> => {
      const { what } = inputSchema.parse(raw)
      try {
        // The resolver is captured OUTSIDE the work function and registered under the id `submit`
        // returns. Doing it inside would be a race: the work may run before the id exists, and
        // `task_complete` would then look up a key nothing had written.
        let release!: () => void
        const handle = await options.registry.submit(
          'custom',
          // The deferred promise IS the declaration. It resolves when `task_complete` runs, and
          // `ctx.signal` is honoured so a cancelled run does not leave it pending forever.
          (ctx) =>
            new Promise<void>((resolve) => {
              release = resolve
              if (ctx.signal.aborted) {
                resolve()
                return
              }
              ctx.signal.addEventListener(
                'abort',
                () => {
                  resolve()
                },
                { once: true },
              )
            }),
        )
        options.registry.resolvers.set(handle.id, release)
        return JSON.stringify({ ok: true, id: handle.id, what })
      } catch (error) {
        // Reported to the model rather than thrown: a registry that is down is not a reason for the
        // run to end, and the model can decide whether to proceed without a declaration.
        return JSON.stringify({
          ok: false,
          error: 'registry_refused',
          message: error instanceof Error ? error.message : String(error),
        })
      }
    },
  }
}

/** The completion tool: the declared unit is done. */
export function createTaskCompleteTool(options: TaskToolOptions) {
  const inputSchema = z.object({
    id: z.string().min(1).describe('The id task_declare returned for the unit you are completing.'),
  })

  return {
    name: options.name ?? 'task_complete',
    description:
      'Mark a unit you declared with task_declare as done, using the id it returned. ' +
      'A unit you never complete stays open, which is a different fact from never having declared it.',
    inputSchema,
    // `async` with nothing awaited, deliberately. The handler contract returns `Promise<string>`,
    // and — the half that matters — `async` is what turns the throw below into a REJECTED promise.
    // Dropped, it would throw synchronously, and a caller doing `tool.handler(x).catch(...)` would
    // never see it: the throw would escape before a promise existed to catch on.
    // eslint-disable-next-line @typescript-eslint/require-await -- see the paragraph above
    handler: async (raw: unknown): Promise<string> => {
      const { id } = inputSchema.parse(raw)
      const release = options.registry.resolvers.get(id)
      if (release === undefined) {
        // RAISES rather than returning a no-op result. A silent no-op would leave the agent believing
        // the unit closed while the list still shows it open — the one outcome nobody can detect,
        // and what `rules/error-handling.md` § 2 forbids.
        throw new Error(
          `task_complete: no declared task with id '${id}' — it was never declared, or already completed`,
        )
      }
      release()
      options.registry.resolvers.delete(id)
      return JSON.stringify({ ok: true, id })
    },
  }
}
