/**
 * A stand-in for the framework's `loadMcpScopes` in tests that mock `loadMcpJson` by directory.
 *
 * The framework loads through a module-internal reader that a mock of the package's `loadMcpJson`
 * export cannot reach, so this feeds it that mock and applies the one decision under test:
 * `projectAllowed` is the trust gate.
 *
 * It models the PROJECT scope only: `personal` is always empty and no clash is ever `shadowed`, so a
 * test using it cannot see the personal scope or the clash rule. Those are the framework's
 * (`loadMcpScopes`) and are asserted through the real function in `mcp-scopes.test.ts`.
 */
export function keyedMcpScopes(
  loadMcpJson: (dir: string) => Record<string, unknown>,
): (input: { cwd: string; projectAllowed: boolean }) => {
  servers: Record<string, unknown>
  personal: string[]
  projectWithheld: string[]
  shadowed: never[]
} {
  return (input) => {
    const project = loadMcpJson(input.cwd)
    return {
      servers: input.projectAllowed ? project : {},
      personal: [],
      projectWithheld: input.projectAllowed ? [] : Object.keys(project),
      shadowed: [],
    }
  }
}
