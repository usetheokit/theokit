/** The emoji `THEOCLAW_ACK_REACTION` names, or undefined while it is unset or `off`. */
export function readAckReaction(
  env: Readonly<Record<string, string | undefined>>,
): string | undefined {
  const value = env.THEOCLAW_ACK_REACTION?.trim()
  return value === undefined || value === '' || value.toLowerCase() === 'off' ? undefined : value
}
