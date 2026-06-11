import { z } from 'zod'

/**
 * StorageManager schemas (T1.1 / ADR-0007 D4).
 *
 * `theo.config.ts > storage` declares Postgres servers (credentials), the
 * databases on each server (TheoCloud / managed PG / self-host), and Redis
 * servers. The runtime `StorageManager` consumes this block; adapters
 * (PostgresJobBackend, PostgresConversationStorage, etc.) request pools by
 * database name and never see raw credentials at the call site.
 *
 * EC-1 (DOCUMENT in concept doc T4.1): Zod default strip-unknown mode
 * silently drops typo keys (`databasees` instead of `databases`). The
 * concept doc warns users to use exact names; runtime errors are still
 * actionable (`Database "X" not configured`).
 *
 * EC-2 (DEFERRED to use-time): `databases.X.server` references a key in
 * `servers`. Cross-field validation is intentionally NOT enforced at parse
 * time — `StorageManager.usePostgres()` throws an actionable error on the
 * first call with the dangling reference, matching Rails / Nitro behavior.
 */
const tlsConfigSchema = z.object({
  rejectUnauthorized: z.boolean().optional(),
  caCert: z.string().optional(),
  clientCert: z.string().optional(),
  clientKey: z.string().optional(),
})

const serverConfigSchema = z.object({
  host: z.string().min(1),
  port: z.number().int().positive().max(65535).optional(),
  user: z.string().min(1),
  /** Password may be the empty string (some providers permit it). */
  password: z.string(),
  tls: tlsConfigSchema.optional(),
})

const postgresPoolConfigSchema = z.object({
  min: z.number().int().nonnegative().optional(),
  max: z.number().int().positive().optional(),
  connectionTimeoutMillis: z.number().int().positive().optional(),
  idleTimeoutMillis: z.number().int().nonnegative().optional(),
})

const postgresDatabaseConfigSchema = z.object({
  /** References a key in `storage.servers`. Resolved at `usePostgres()` call time. */
  server: z.string().min(1),
  database: z.string().min(1),
  pool: postgresPoolConfigSchema.optional(),
})

const redisServerConfigSchema = serverConfigSchema.extend({
  db: z.number().int().nonnegative().optional(),
  maxRetriesPerRequest: z.number().int().nonnegative().optional(),
})

export const storageSchema = z.object({
  servers: z.record(z.string(), serverConfigSchema).optional(),
  databases: z.record(z.string(), postgresDatabaseConfigSchema).optional(),
  redis: z.record(z.string(), redisServerConfigSchema).optional(),
})

export type StorageConfig = z.infer<typeof storageSchema>
