/**
 * The standard session commands every chat assistant has, bound to injected session operations.
 *
 * Transport-neutral: the definitions are plain `CommandDefinition`s, so a gateway command hook and a
 * web text router both run the same `run` and reach the same session methods. Replies and argument
 * validation (a model id, an effort level) belong to the injected callbacks.
 *
 * `/new`, `/reset`, `/stop`, `/compact` and `/status` are `exact`: matched on the whole trimmed
 * text, so `/new chat` is not a reset. `/steer`, `/model` and `/think` take an argument.
 *
 * Every handler also receives the caller's context (`Ctx`, default `void`): a chat surface passes the
 * message it answers, so the handler knows which conversation it serves.
 */
import { defineCommand, type CommandDefinition } from './command-router.js'

type Handler<Ctx> = (ctx: Ctx) => void | Promise<void>
type ArgHandler<Ctx> = (arg: string, ctx: Ctx) => void | Promise<void>

/** The session operations the commands call. Every handler is optional; a missing one omits its command. */
export interface SessionCommandHandlers<Ctx = void> {
  reset?: Handler<Ctx>
  stop?: Handler<Ctx>
  steer?: ArgHandler<Ctx>
  compact?: Handler<Ctx>
  setModel?: ArgHandler<Ctx>
  setEffort?: ArgHandler<Ctx>
  status?: Handler<Ctx>
  clear?: Handler<Ctx>
  retry?: Handler<Ctx>
  /** `/usage [arg]`: the argument is optional and may be empty. */
  usage?: ArgHandler<Ctx>
  help?: Handler<Ctx>
  /** `/quit`, alias `/exit`. */
  quit?: Handler<Ctx>
  sessions?: Handler<Ctx>
  resume?: ArgHandler<Ctx>
  fork?: Handler<Ctx>
  rename?: ArgHandler<Ctx>
  archive?: ArgHandler<Ctx>
  delete?: ArgHandler<Ctx>
  goal?: ArgHandler<Ctx>
  login?: ArgHandler<Ctx>
  logout?: Handler<Ctx>
}

/** Build the standard session command definitions for the handlers supplied. */
export function sessionCommands<Ctx = void>(
  handlers: SessionCommandHandlers<Ctx>,
): CommandDefinition<Ctx>[] {
  const out: CommandDefinition<Ctx>[] = []
  /** A command with no argument, matched on the whole text. */
  const bare = (
    name: string,
    description: string,
    fn: Handler<Ctx> | undefined,
    aliases?: readonly string[],
  ): void => {
    if (!fn) return
    out.push(
      defineCommand<Ctx>({
        name,
        description,
        arg: 'none',
        exact: true,
        ...(aliases ? { aliases } : {}),
        run: (_arg, ctx) => fn(ctx),
      }),
    )
  }
  const withArg = (
    name: string,
    description: string,
    arg: 'required' | 'optional',
    fn: ArgHandler<Ctx> | undefined,
  ): void => {
    if (!fn) return
    out.push(defineCommand<Ctx>({ name, description, arg, run: (a, ctx) => fn(a, ctx) }))
  }
  bare('new', 'Start a new conversation', handlers.reset, ['reset'])
  bare('stop', 'Stop the current turn', handlers.stop)
  withArg('steer', 'Steer the running turn', 'required', handlers.steer)
  bare('compact', 'Compact the conversation', handlers.compact)
  withArg('model', 'Set the model', 'required', handlers.setModel)
  withArg('think', 'Set the reasoning effort', 'required', handlers.setEffort)
  bare('status', 'Show session status', handlers.status)
  bare('clear', 'Clear the conversation', handlers.clear)
  bare('retry', 'Re-send the last message', handlers.retry)
  withArg('usage', 'Show token usage', 'optional', handlers.usage)
  bare('help', 'Show help', handlers.help)
  bare('quit', 'Quit', handlers.quit, ['exit'])
  bare('sessions', 'List sessions', handlers.sessions)
  withArg('resume', 'Resume a session', 'required', handlers.resume)
  bare('fork', 'Branch the session into a new one', handlers.fork)
  withArg('rename', 'Rename the session', 'required', handlers.rename)
  withArg('archive', 'Archive a session', 'required', handlers.archive)
  withArg('delete', 'Delete a session', 'required', handlers.delete)
  withArg('goal', 'Work on a goal', 'required', handlers.goal)
  withArg('login', 'Sign in to a provider', 'required', handlers.login)
  bare('logout', 'Remove the stored credential', handlers.logout)
  return out
}
