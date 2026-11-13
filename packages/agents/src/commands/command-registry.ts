import { TheokitAgentError } from '@theokit/sdk/errors'

import { routeCommand } from './command-router.js'
import type { CommandDefinition, RoutedInput } from './command-router.js'

/** Thrown at creation when two definitions or aliases claim the same name. */
export class CommandRegistryError extends TheokitAgentError {
  override readonly name = 'CommandRegistryError'
  readonly claimed: string
  readonly owners: readonly [string, string]

  constructor(claimed: string, first: string, second: string) {
    super(`command name "${claimed}" is claimed by both "${first}" and "${second}"`, {
      code: 'COMMAND_NAME_COLLISION',
      // the same definitions collide the same way on every attempt.
      isRetryable: false,
    })
    this.claimed = claimed
    this.owners = [first, second]
  }
}

/** One list of commands for the palette, the router and the handlers. */
export interface CommandRegistry<Ctx> {
  /** Visible, canonical names only, in definition order. */
  palette(): readonly { name: string; description: string }[]
  /** `command` is the canonical definition even when an alias was typed. */
  route(input: string): RoutedInput<Ctx>
  /** Routes, then calls `run` when the input is a command that has one. */
  dispatch(input: string, ctx: Ctx): Promise<RoutedInput<Ctx>>
}

export function createCommandRegistry<Ctx>(
  definitions: readonly CommandDefinition<Ctx>[],
): CommandRegistry<Ctx> {
  const owners = new Map<string, string>()
  for (const definition of definitions) {
    for (const name of [definition.name, ...(definition.aliases ?? [])]) {
      const owner = owners.get(name)
      if (owner !== undefined) throw new CommandRegistryError(name, owner, definition.name)
      owners.set(name, definition.name)
    }
  }
  const list = [...definitions]

  const route = (input: string): RoutedInput<Ctx> => routeCommand(input, list)
  return {
    palette: () =>
      list
        .filter((definition) => definition.hidden !== true)
        .map(({ name, description }) => ({ name, description })),
    route,
    async dispatch(input, ctx) {
      const routed = route(input)
      if (routed.kind === 'command' && routed.command.run !== undefined) {
        await routed.command.run(routed.arg, ctx)
      }
      return routed
    },
  }
}
