// Define your Drizzle tables here. Example:
//
// import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'
//
// export const posts = sqliteTable('posts', {
//   id: integer('id').primaryKey({ autoIncrement: true }),
//   title: text('title').notNull(),
//   published: integer('published', { mode: 'boolean' }).notNull().default(false),
//   createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
// })
//
// Or scaffold a full resource (schema + routes + test):
//   npx theokit generate resource posts title:string published:boolean
