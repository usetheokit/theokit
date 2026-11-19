import type { Pool } from 'pg'
import { expectTypeOf } from 'vitest'

import { createPostgresJobStore, type SqlPool } from '../../src/schedule/postgres-job-store.js'

// A real `pg` Pool must be passable as the store's pool, with no cast.
declare const pgPool: Pool
expectTypeOf(pgPool).toExtend<SqlPool>()
void createPostgresJobStore(pgPool)
