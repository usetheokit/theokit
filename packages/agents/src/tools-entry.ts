// M62 — `@theokit/agents/tools`: pass-through of `@theokit/sdk-tools`'s ready-made tool factories
// (`createReadFileTool`, `createShellTool`, … + `withName`/`withDescription`). These are stateless
// third-party factories — enriching them would be reinventing the SDK-tools' own sugar (blueprint Q5),
// so this is a pure re-export (parsimony Rung 9). The consumer imports its built-in tools from the
// Theokit layer, not from `@theokit/sdk-tools` directly. `@theokit/sdk-tools` is an OPTIONAL peer —
// only consumers of this subpath need it installed.

// M90 — a lista é NOMEADA, não `export *`.
//
// A decisão de não envolver em wrapper (rung 9, acima) continua valendo: enumerar não é envolver. O
// que muda é outra coisa — com `export *`, um símbolo removido upstream simplesmente deixa de existir
// na superfície e o build DESTA camada passa; o consumidor descobre em call site. Com nome explícito,
// o `tsc` aponta a linha. É a propriedade que `auth-entry.ts` já tinha e estes cinco não.
//
// A superfície é preservada INTEIRA (medido: 93 símbolos, paridade idêntica à fonte). Reduzir seria
// breaking para outros consumidores, e o M73 já escreveu a regra no `auth-entry.ts`: enriquecer nunca
// reduz. Se um símbolo for deliberadamente retido no futuro, a razão vem escrita aqui, como lá.
//
// Gerado por `scripts/gerar-reexports.mts`; travado por `tests/unit/subpath-surface.test.ts`.

export {
  buildEnvContext,
  buildRepoMap,
  CatastrophicCommandError,
  catastrophicShellReason,
  commandDenialReason,
  ContextMatchError,
  createApplyPatchTool,
  createBraveWebSearchAdapter,
  createCurrentTimeTool,
  createEditFileTool,
  createGenericHttpSearchAdapter,
  createGitDiffTool,
  createGitStatusTool,
  createGlobTool,
  createInteractiveShellTool,
  createListDirTool,
  createPlanModeTool,
  createQuestionTool,
  createReadFileTool,
  createRunVitestTool,
  createSearchTextTool,
  createSessionArtifactStore,
  createShellTool,
  createTodolistTool,
  createUpdatePlanTool,
  createWebFetchTool,
  createWebSearchTool,
  createWriteFileTool,
  createWriteStdinTool,
  DEFAULT_TOOL_GUIDANCE,
  denyCatastrophicCommands,
  formatCode,
  formatDiff,
  formatError,
  formatFileList,
  injectGuidance,
  isBlockedIp,
  isCommandAllowed,
  ReadTracker,
  ReasoningTools,
  RedirectBlockedError,
  renderToolList,
  replaceUnique,
  resolveAndScreen,
  screenedFetch,
  SsrfBlockedError,
  todoItemsToPlanNodes,
  truncateOutput,
  withDefaultGuidance,
  withDescription,
  withName,
  withShellExitGuidance,
  withToolResultGuidance,
} from '@theokit/sdk-tools'

export type {
  CommandPolicy,
  ContextMatchReason,
  CreateApplyPatchToolOptions,
  CreateBraveWebSearchAdapterOptions,
  CreateCurrentTimeToolOptions,
  CreateEditFileToolOptions,
  CreateGenericHttpSearchAdapterOptions,
  CreateGitDiffToolOptions,
  CreateGitStatusToolOptions,
  CreateGlobToolOptions,
  CreateInteractiveShellToolOptions,
  CreateListDirToolOptions,
  CreateReadFileToolOptions,
  CreateRunVitestToolOptions,
  CreateSearchTextToolOptions,
  CreateShellToolOptions,
  CreateWebFetchToolOptions,
  CreateWebSearchToolOptions,
  CreateWriteFileToolOptions,
  EnvContextOptions,
  PlanModeTool,
  PlanModeToolOptions,
  PlanModeToolWithStore,
  PlanNode,
  QuestionTool,
  QuestionToolOptions,
  RepoMapOptions,
  ResolveAndScreenOptions,
  ScreenedFetchOptions,
  SessionArtifactStore,
  SessionArtifactStoreOptions,
  TodoItem,
  TodolistTool,
  ToolGuidanceMap,
  TruncationMode,
  TruncationOptions,
  TruncationResult,
  VitestSummary,
  WebSearchCallback,
  WebSearchResult,
} from '@theokit/sdk-tools'
