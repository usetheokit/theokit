// M58 — `@theokit/agents/sandbox`: pass-through of the SDK's already-OO sandbox surface
// (`LocalSandbox` class + `SandboxBackend` contract + `SandboxConfig`). The consumer imports its
// sandbox primitives from the Theokit layer, not from `@theokit/sdk/sandbox` directly. Re-export,
// never a wrapper (parsimony-ladder Rung 9): `SandboxBackend` is already the interface to depend on.

// M90 — a lista é NOMEADA, não `export *`.
//
// A decisão de não envolver em wrapper (rung 9, acima) continua valendo: enumerar não é envolver. O
// que muda é outra coisa — com `export *`, um símbolo removido upstream simplesmente deixa de existir
// na superfície e o build DESTA camada passa; o consumidor descobre em call site. Com nome explícito,
// o `tsc` aponta a linha. É a propriedade que `auth-entry.ts` já tinha e estes cinco não.
//
// A superfície é preservada INTEIRA (medido: 36 símbolos, paridade idêntica à fonte). Reduzir seria
// breaking para outros consumidores, e o M73 já escreveu a regra no `auth-entry.ts`: enriquecer nunca
// reduz. Se um símbolo for deliberadamente retido no futuro, a razão vem escrita aqui, como lá.
//
// Gerado por `scripts/gerar-reexports.mts`; travado por `tests/unit/subpath-surface.test.ts`.

export {
  allowlistedEnv,
  buildBwrapArgv,
  buildSeccompFilter,
  createSandboxBackend,
  detectBwrap,
  detectBwrapMemoized,
  interactiveWrapCommand,
  LinuxSandbox,
  LocalSandbox,
  provisionRepo,
  realProbeCount,
  realProbes,
  RepoProvisionError,
  resetBwrapMemo,
  resetInteractiveWarnLatch,
  resetSandboxWarnLatch,
  resolveSandbox,
  resolveSandboxPosture,
  restrictedSeccompPath,
  SandboxBackend,
  SandboxNotAvailableError,
  SandboxSecurityError,
  seccompPathForArch,
  wrapCommandForSandbox,
} from '@theokit/sdk/sandbox'

export type {
  BwrapArgvOptions,
  BwrapDetection,
  BwrapProbes,
  CreateSandboxBackendOptions,
  ExecuteResult,
  InteractiveWrapOptions,
  ProvisionRepoOptions,
  SandboxConfig,
  SandboxMode,
  SandboxPosture,
  SandboxProvider,
  SeccompOptions,
} from '@theokit/sdk/sandbox'
