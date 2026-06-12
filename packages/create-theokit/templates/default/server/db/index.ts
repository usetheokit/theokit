import { drizzle } from 'drizzle-orm/better-sqlite3'
import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import * as schema from './schema.js'

mkdirSync('data', { recursive: true })
const sqlite = new Database('data/dev.db')
sqlite.pragma('journal_mode = WAL')

export const db = drizzle(sqlite, { schema })
