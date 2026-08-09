// M58 — `@theokit/agents/pty`: pass-through of `@theokit/sdk-pty`'s already-OO `PtyInteractiveBackend`
// (the PTY implementation of the `InteractiveBackend` contract). Re-export, never a wrapper
// (parsimony-ladder Rung 9). This is the one M58 domain that pulls a SEPARATE package, so `@theokit/
// sdk-pty` is declared a dependency of `@theokit/agents` — the consumer no longer depends on it directly.
// M90 — a lista é NOMEADA, não `export *`.
//
// A decisão de não envolver em wrapper (rung 9, acima) continua valendo: enumerar não é envolver. O
// que muda é outra coisa — com `export *`, um símbolo removido upstream simplesmente deixa de existir
// na superfície e o build DESTA camada passa; o consumidor descobre em call site. Com nome explícito,
// o `tsc` aponta a linha. É a propriedade que `auth-entry.ts` já tinha e estes cinco não.
//
// A superfície é preservada INTEIRA (medido: 6 símbolos, paridade idêntica à fonte). Reduzir seria
// breaking para outros consumidores, e o M73 já escreveu a regra no `auth-entry.ts`: enriquecer nunca
// reduz. Se um símbolo for deliberadamente retido no futuro, a razão vem escrita aqui, como lá.
//
// Gerado por `scripts/generate-reexports.mts`; travado por `tests/unit/subpath-surface.test.ts`.

export {
  clampYield,
  MaxSessionsError,
  PtyInteractiveBackend,
  YIELD_MAX_MS,
  YIELD_MIN_MS,
} from '@theokit/sdk-pty'

export type { PtyInteractiveBackendOptions } from '@theokit/sdk-pty'
