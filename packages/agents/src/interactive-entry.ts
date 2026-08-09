// M58 — `@theokit/agents/interactive`: pass-through of the SDK's already-OO interactive surface
// (`InteractiveBackend` contract + `StartInteractiveOptions` / `StartInteractiveResult`). Re-export,
// never a wrapper (parsimony-ladder Rung 9): the backend interface is already the seam to depend on.

// M90 — a lista é NOMEADA, não `export *`.
//
// A decisão de não envolver em wrapper (rung 9, acima) continua valendo: enumerar não é envolver. O
// que muda é outra coisa — com `export *`, um símbolo removido upstream simplesmente deixa de existir
// na superfície e o build DESTA camada passa; o consumidor descobre em call site. Com nome explícito,
// o `tsc` aponta a linha. É a propriedade que `auth-entry.ts` já tinha e estes cinco não.
//
// A superfície é preservada INTEIRA (medido: 9 símbolos, paridade idêntica à fonte). Reduzir seria
// breaking para outros consumidores, e o M73 já escreveu a regra no `auth-entry.ts`: enriquecer nunca
// reduz. Se um símbolo for deliberadamente retido no futuro, a razão vem escrita aqui, como lá.
//
// Gerado por `scripts/generate-reexports.mts`; travado por `tests/unit/subpath-surface.test.ts`.

export {
  InteractiveBackend,
  InteractiveUnavailableError,
  NoSuchSessionError,
  resolveInteractive,
} from '@theokit/sdk/interactive'

export type {
  InteractiveProvider,
  StartInteractiveOptions,
  StartInteractiveResult,
  WriteStdinOptions,
  WriteStdinResult,
} from '@theokit/sdk/interactive'
