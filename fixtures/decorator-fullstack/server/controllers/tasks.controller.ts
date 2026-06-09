/**
 * TasksController — NestJS-style decorator controller.
 *
 * Uses @Controller/@Get/@Post/@Delete decorators from @theokit/http-decorators.
 * Wired into TheoKit via httpDecoratorsPlugin in theo.config.ts.
 *
 * NOTE: Parameter decorators (@Body, @Param, @Query) require tsc with
 * emitDecoratorMetadata. In dev mode (Vite/esbuild), parameter metadata
 * is shimmed via wireParam() at module level — same pattern as vitest tests.
 * In production builds via tsc, the shim is not needed.
 */
import 'reflect-metadata'
import {
  Controller, Get, Post, Delete,
  HttpCode, UseGuards,
  setMeta, ROUTE_PARAMS,
} from '../../../../packages/http-decorators/src/index.js'
import { taskStore } from '../routes/tasks/_store.js'
import { AuthGuard } from '../guards/auth.guard.js'

// ── DTO ────────────────────────────────────────────
import { z } from 'zod'
const zCreateTask = z.object({
  title: z.string().min(3, 'Title must be at least 3 characters'),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
})
class CreateTaskDto { static schema = zCreateTask }

// ── Controller (class + method decorators work in esbuild) ──

@Controller('api/v2/tasks')
export class TasksController {
  findAll() { return taskStore.findAll() }
  search(q: string) { return taskStore.findAll().filter(t => t.title.toLowerCase().includes((q ?? '').toLowerCase())) }
  findById(id: string) { return taskStore.findById(id) ?? { error: 'Task not found' } }
  create(body: z.infer<typeof zCreateTask>) { return taskStore.create(body) }
  complete(id: string) { return taskStore.complete(id) ?? { error: 'Task not found' } }
  remove(id: string) { taskStore.remove(id) }
  stats() { return taskStore.stats() }
}

// Method decorators (work in esbuild)
Get()(TasksController.prototype, 'findAll', Object.getOwnPropertyDescriptor(TasksController.prototype, 'findAll')!)
Get('search')(TasksController.prototype, 'search', Object.getOwnPropertyDescriptor(TasksController.prototype, 'search')!)
Get(':id')(TasksController.prototype, 'findById', Object.getOwnPropertyDescriptor(TasksController.prototype, 'findById')!)
Post()(TasksController.prototype, 'create', Object.getOwnPropertyDescriptor(TasksController.prototype, 'create')!)
Post(':id/complete')(TasksController.prototype, 'complete', Object.getOwnPropertyDescriptor(TasksController.prototype, 'complete')!)
Delete(':id')(TasksController.prototype, 'remove', Object.getOwnPropertyDescriptor(TasksController.prototype, 'remove')!)
HttpCode(204)(TasksController.prototype, 'remove', Object.getOwnPropertyDescriptor(TasksController.prototype, 'remove')!)
Get('stats')(TasksController.prototype, 'stats', Object.getOwnPropertyDescriptor(TasksController.prototype, 'stats')!)
UseGuards(AuthGuard)(TasksController.prototype, 'stats')

// Parameter metadata shim (esbuild doesn't emit design:paramtypes)
// With tsc in production, these are generated automatically by @Body/@Param/@Query decorators
function wp(ctrl: Function, method: string, idx: number, src: string, key?: string) {
  const map = Reflect.getMetadata(ROUTE_PARAMS, ctrl) ?? new Map()
  const entries = map.get(method) ?? []
  entries.push({ source: src, key, index: idx })
  map.set(method, entries)
  setMeta(ROUTE_PARAMS, ctrl, map)
}
wp(TasksController, 'search', 0, 'query', 'q')
wp(TasksController, 'findById', 0, 'param', 'id')
wp(TasksController, 'create', 0, 'body', undefined)
wp(TasksController, 'complete', 0, 'param', 'id')
wp(TasksController, 'remove', 0, 'param', 'id')
Reflect.defineMetadata('design:paramtypes', [CreateTaskDto], TasksController.prototype, 'create')
