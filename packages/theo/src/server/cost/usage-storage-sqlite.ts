import { createRequire } from 'node:module'

import type { StorageAdapter } from '../storage/storage-types.js'

import type {
  ToolUsageRecord,
  UsageQuery,
  UsageRecord,
  UsageResult,
  UsageStorageAdapter,
} from './cost-types.js'

/**
 * Usage storage that survives a restart.
 *
 * `UsageStorageAdapter` existed so a deployment could answer "what did this tenant cost last
 * month", and every implementation in the organisation was in-memory — so no question spanning a
 * process lifetime could be answered at all (usetheokit/theokit#459). For anything that bills,
 * meters or caps per tenant, that is the whole reason to record usage.
 *
 * ## Why `node:sqlite` and not a dependency
 *
 * It costs no install time and no native build step, which matters here specifically because the
 * framework's install weight is itself an open issue (#460). A deployment that wants Postgres
 * implements the same two-method interface; this is the durable DEFAULT, not the only shape.
 *
 * ## It is NOT available at this package's engine floor
 *
 * `engines.node` says `>=22.12`, and `node:sqlite` is not a built-in module there — it became
 * available unflagged later in the 22.x line. The first version of this file asserted the opposite
 * ("the engine is already >=22.12 and the module is built in"), which was true on the machine that
 * wrote it and false on the floor the package promises. CI caught it on the `22.12` leg with
 * `No such built-in module: node:sqlite`.
 *
 * So the module is loaded LAZILY, and a runtime without it gets a refusal that names the reason
 * rather than an import crash. That is the honest shape for an opt-in adapter behind its own
 * subpath: a deployment on 22.12 simply does not use this one.
 *
 * Node reports SQLite as experimental. That is a stability warning about the module's API, not
 * about the database, and the surface used here is `exec` / `prepare` / `run` / `get` — the part
 * least likely to move.
 *
 * ## What it stores
 *
 * Both record kinds, in one table, discriminated by `kind` — the interface takes a union and an
 * adapter that dropped tool records would silently lose the latency and error data
 * `trackAgentTools` emits. `getUsage` sums only `llm` rows, because a tool call has no token or
 * cost dimension and counting it as a run would inflate an invoice.
 *
 * The period is inclusive at BOTH ends, matching `InMemoryUsageStorage` exactly (`t < from ||
 * t > to`). An adapter swap must not change an invoice.
 */
/** The slice of `node:sqlite` this adapter uses. Named so the lazy load stays typed. */
interface SqliteDatabase {
  exec(sql: string): void
  prepare(sql: string): {
    run(...params: unknown[]): void
    get(...params: unknown[]): unknown
  }
  close(): void
}

/**
 * Load `node:sqlite`, or refuse with the reason.
 *
 * `createRequire` rather than a static import: a static one crashes the module at load on any
 * runtime without it, which would take down anything that so much as imported this file.
 */
function loadSqlite(): new (filename: string) => SqliteDatabase {
  try {
    const require_ = createRequire(import.meta.url)
    const mod = require_('node:sqlite') as { DatabaseSync: new (f: string) => SqliteDatabase }
    return mod.DatabaseSync
  } catch {
    throw new Error(
      'SqliteUsageStorage needs `node:sqlite`, which this Node does not provide ' +
        `(running ${process.version}). It is not available at this package's engine floor of ` +
        '22.12 — upgrade Node, or use a different UsageStorageAdapter: the interface is two ' +
        'methods and `InMemoryUsageStorage` shows the shape.',
    )
  }
}

export class SqliteUsageStorage implements UsageStorageAdapter, StorageAdapter {
  readonly name = 'sqlite'
  readonly #db: SqliteDatabase

  /**
   * @param filename path to the database file. `':memory:'` is accepted and is a legitimate choice
   *   for a test, but note that it defeats the entire purpose of this class in a deployment.
   */
  constructor(filename: string) {
    const DatabaseSync = loadSqlite()
    this.#db = new DatabaseSync(filename)
    // WAL so a reader (a dashboard asking for a month's total) does not block the writer recording
    // the run that is happening while it asks.
    this.#db.exec('PRAGMA journal_mode = WAL')
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS usage (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        kind        TEXT    NOT NULL,
        user_id     TEXT    NOT NULL,
        at_ms       INTEGER NOT NULL,
        model       TEXT,
        input_tok   INTEGER,
        output_tok  INTEGER,
        cost_usd    REAL,
        tool_name   TEXT,
        call_id     TEXT,
        success     INTEGER,
        duration_ms INTEGER,
        error       TEXT
      )
    `)
    // The only query this class runs filters on exactly these three, in this order.
    this.#db.exec('CREATE INDEX IF NOT EXISTS usage_lookup ON usage (user_id, kind, at_ms)')
  }

  record(input: UsageRecord | ToolUsageRecord): Promise<void> {
    // EC-9: a record with no `kind` comes from an older adapter and means an LLM call. Normalised
    // here rather than at the query, so the stored row is unambiguous forever after.
    if ('kind' in input && input.kind === 'tool') {
      this.#db
        .prepare(
          `INSERT INTO usage (kind, user_id, at_ms, tool_name, call_id, success, duration_ms, error)
           VALUES ('tool', ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.userId,
          input.timestamp.getTime(),
          input.toolName,
          input.callId,
          input.success ? 1 : 0,
          input.durationMs,
          input.errorMessage ?? null,
        )
      return Promise.resolve()
    }

    const llm = input
    this.#db
      .prepare(
        `INSERT INTO usage (kind, user_id, at_ms, model, input_tok, output_tok, cost_usd)
         VALUES ('llm', ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        llm.userId,
        llm.timestamp.getTime(),
        llm.model,
        llm.tokens.input,
        llm.tokens.output,
        llm.costUsd,
      )
    return Promise.resolve()
  }

  getUsage(query: UsageQuery): Promise<UsageResult> {
    const row = this.#db
      .prepare(
        `SELECT COALESCE(SUM(input_tok + output_tok), 0) AS tokens,
                COALESCE(SUM(cost_usd), 0)               AS cost,
                COUNT(*)                                 AS runs
           FROM usage
          WHERE kind = 'llm' AND user_id = ? AND at_ms >= ? AND at_ms <= ?`,
      )
      .get(query.userId, query.period.from.getTime(), query.period.to.getTime()) as
      | { tokens: number; cost: number; runs: number }
      | undefined

    // No `Number(...)` around these. Measured against `node:sqlite`: `SUM` over INTEGER, `SUM` over
    // REAL and `COUNT(*)` all return a JS number, and so does the empty case through `COALESCE`.
    // The conversions were defensive ceremony against a runtime shape that does not occur, and the
    // linter was right to say the types already knew.
    return Promise.resolve({
      totalTokens: row?.tokens ?? 0,
      totalCostUsd: row?.cost ?? 0,
      runs: row?.runs ?? 0,
    })
  }

  /**
   * `StorageAdapter` lifecycle (ADR-0007 D6). Unlike the in-memory adapter's noop, this one has a
   * file handle to release — a graceful shutdown that left it open would leave the WAL unmerged.
   */
  dispose(): Promise<void> {
    this.#db.close()
    return Promise.resolve()
  }
}
