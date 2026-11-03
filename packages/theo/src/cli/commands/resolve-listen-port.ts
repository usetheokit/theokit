/**
 * The port a command listens on: an explicit flag, then `PORT`, then `config.port`.
 *
 * The flag is a person typing now, the environment is where the process was put (`PORT` is what
 * every container platform injects, usetheokit/theokit#402), and the config is the project's default.
 * `theokit start` and `theokit dev` both resolve it here, so they cannot drift again
 * (usetheokit/theokit#1134: `dev` ignored `PORT` and listened on `config.port`).
 *
 * A `PORT` that is not an integer is ignored rather than turned into `NaN`.
 */
export function resolveListenPort(
  flag: number | undefined,
  env: NodeJS.ProcessEnv,
  configPort: number,
): number {
  if (flag !== undefined) return flag
  const fromEnv = Number.parseInt(env.PORT ?? '', 10)
  return Number.isInteger(fromEnv) ? fromEnv : configPort
}
