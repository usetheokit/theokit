import { drizzle } from 'drizzle-orm/better-sqlite3'
import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import * as schema from './schema.js'

mkdirSync('data', { recursive: true })
const sqlite = new Database('data/dev.db')
sqlite.pragma('journal_mode = WAL')

export const db = drizzle(sqlite, { schema })

// Auto-create tables (simple push — no migration files needed for dev)
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    priority TEXT NOT NULL DEFAULT 'medium',
    done INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (date('now'))
  )
`)
