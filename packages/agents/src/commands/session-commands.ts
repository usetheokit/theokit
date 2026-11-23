/**
 * The standard session commands every chat assistant has, bound to injected session operations.
 *
 * Transport-neutral: the definitions are plain `CommandDefinition`s, so a gateway command hook and a
 * web text router both run the same `run` and reach the same session methods. Replies and argument
 * validation (a model id, an effort level) belong to the injected callbacks.
 *
 * `/new`, `/reset`, `/stop`, `/compact` and `/status` are `exact`: matched on the whole trimmed
 * text, so `/new chat` is not a reset. `/steer`, `/model` and `/think` take an argument.
 */
import { defineCommand, type CommandDefinition } from './command-router.js'

/** The session operations the commands call. Every handler is optional; a missing one omits its command. */
export interface SessionCommandHandlers {
  reset?: () => void | Promise<void>
  stop?: () => void | Promise<void>
  steer?: (text: string) => void | Promise<void>
  compact?: () => void | Promise<void>
  setModel?: (model: string) => void | Promise<void>
  setEffort?: (effort: string) => void | Promise<void>
  status?: () => void | Promise<void>
}

/** Build the standard session command definitions for the handlers supplied. */
export function sessionCommands(handlers: SessionCommandHandlers): CommandDefinition[] {
  const out: CommandDefinition[] = []
  const { reset, stop, steer, compact, setModel, setEffort, status } = handlers
  if (reset)
    out.push(
      defineCommand({
        name: 'new',
        aliases: ['reset'],
        description: 'Start a new conversation',
        arg: 'none',
        exact: true,
        run: () => reset(),
      }),
    )
  if (stop)
    out.push(
      defineCommand({
        name: 'stop',
        description: 'Stop the current turn',
        arg: 'none',
        exact: true,
        run: () => stop(),
      }),
    )
  if (steer)
    out.push(
      defineCommand({
        name: 'steer',
        description: 'Steer the running turn',
        arg: 'required',
        run: (arg) => steer(arg),
      }),
    )
  if (compact)
    out.push(
      defineCommand({
        name: 'compact',
        description: 'Compact the conversation',
        arg: 'none',
        exact: true,
        run: () => compact(),
      }),
    )
  if (setModel)
    out.push(
      defineCommand({
        name: 'model',
        description: 'Set the model',
        arg: 'required',
        run: (arg) => setModel(arg),
      }),
    )
  if (setEffort)
    out.push(
      defineCommand({
        name: 'think',
        description: 'Set the reasoning effort',
        arg: 'required',
        run: (arg) => setEffort(arg),
      }),
    )
  if (status)
    out.push(
      defineCommand({
        name: 'status',
        description: 'Show session status',
        arg: 'none',
        exact: true,
        run: () => status(),
      }),
    )
  return out
}
