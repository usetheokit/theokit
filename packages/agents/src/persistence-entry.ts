// M58 — `@theokit/agents/persistence`: pass-through of the SDK's pure persistence helpers
// (`transcriptPath`, `encodeProjectDir`, `atomicWriteText`, `SessionRecord`). These are stateless
// path/IO helpers — wrapping a pure free function in a class would be the ceremony parsimony refuses
// (Rung 5). Re-export only (Rung 9); the consumer imports them from the Theokit layer.
export * from '@theokit/sdk/persistence'
