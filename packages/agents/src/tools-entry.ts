// M62 — `@theokit/agents/tools`: pass-through of `@theokit/sdk-tools`'s ready-made tool factories
// (`createReadFileTool`, `createShellTool`, … + `withName`/`withDescription`). These are stateless
// third-party factories — enriching them would be reinventing the SDK-tools' own sugar (blueprint Q5),
// so this is a pure re-export (parsimony Rung 9). The consumer imports its built-in tools from the
// Theokit layer, not from `@theokit/sdk-tools` directly. `@theokit/sdk-tools` is an OPTIONAL peer —
// only consumers of this subpath need it installed.
export * from '@theokit/sdk-tools'
