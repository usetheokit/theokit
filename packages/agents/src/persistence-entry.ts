// M58 — `@theokit/agents/persistence`: pass-through of the SDK's pure persistence helpers
// (`transcriptPath`, `encodeProjectDir`, `atomicWriteText`, `SessionRecord`). These are stateless
// path/IO helpers — wrapping a pure free function in a class would be the ceremony parsimony refuses
// (Rung 5). Re-export only (Rung 9); the consumer imports them from the Theokit layer.

// M90 — a lista é NOMEADA, não `export *`.
//
// A decisão de não envolver em wrapper (rung 9, acima) continua valendo: enumerar não é envolver. O
// que muda é outra coisa — com `export *`, um símbolo removido upstream simplesmente deixa de existir
// na superfície e o build DESTA camada passa; o consumidor descobre em call site. Com nome explícito,
// o `tsc` aponta a linha. É a propriedade que `auth-entry.ts` já tinha e estes cinco não.
//
// A superfície é preservada INTEIRA (medido: 29 símbolos, paridade idêntica à fonte). Reduzir seria
// breaking para outros consumidores, e o M73 já escreveu a regra no `auth-entry.ts`: enriquecer nunca
// reduz. Se um símbolo for deliberadamente retido no futuro, a razão vem escrita aqui, como lá.
//
// Gerado por `scripts/gerar-reexports.mts`; travado por `tests/unit/subpath-surface.test.ts`.

export {
  acquireSessionWriter,
  appendJsonl,
  applyWalWithFallback,
  atomicWriteJson,
  atomicWriteText,
  encodeProjectDir,
  forkTranscript,
  isCorruptionError,
  JsonlParseError,
  LiveSessionError,
  loadJsonl,
  openSqliteResilient,
  PersistenceSchema,
  readJsonlIds,
  readJsonlTail,
  replaceFileAtomic,
  sanitizeFts5Query,
  SessionBusyError,
  // M95 — consulta sem tomar a trava; perguntar tomando cria a disputa que se queria detectar.
  // Renomeado de `sessaoTemEscritor` no `@theokit/sdk@4.39.0`.
  sessionHasWriter,
  transcriptPath,
  // M94 — a raiz do estado de transcript. O consumidor a duplicava em TRÊS arquivos, e as três
  // cópias ignoravam `THEOKIT_HOME` junto com a original.
  transcriptRoot,
  withCwdMutex,
  withFileLock,
} from '@theokit/sdk/persistence'

export type {
  AtomicWriteJsonOptions,
  FileLockOptions,
  ForkTranscriptOptions,
  OpenSqliteResilientOptions,
  ReadJsonlTailOptions,
  ResilientSqliteDb,
  SessionWriterLease,
  WalApplyResult,
  // M94 — a forma do registro deixa de ser `Record<string, unknown>`.
  TranscriptBlock,
  TranscriptMessage,
} from '@theokit/sdk/persistence'
