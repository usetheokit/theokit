import { db } from './index.js'
import { tasks } from './schema.js'
import { sql } from 'drizzle-orm'

const seedData = [
  {
    title: 'Set up TheoKit project',
    priority: 'high' as const,
    done: true,
    createdAt: '2026-01-01',
  },
  { title: 'Create first route', priority: 'high' as const, done: true, createdAt: '2026-01-02' },
  { title: 'Add AI agent', priority: 'medium' as const, done: false, createdAt: '2026-01-03' },
  { title: 'Deploy to production', priority: 'low' as const, done: false, createdAt: '2026-01-04' },
]

// Idempotent: only insert if table is empty
const count = db
  .select({ count: sql<number>`count(*)` })
  .from(tasks)
  .get()
if (!count || count.count === 0) {
  for (const task of seedData) {
    db.insert(tasks).values(task).run()
  }
  console.log(`Seeded ${seedData.length} tasks`)
} else {
  console.log(`Tasks table already has ${count.count} rows — skipping seed`)
}
