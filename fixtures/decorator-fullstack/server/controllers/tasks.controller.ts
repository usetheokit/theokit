import 'reflect-metadata'
import { z } from 'zod'
import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  UseGuards,
  UseInterceptors,
  createDecorator,
  Reflector,
  SetMetadata,
  NotFoundException,
  ForbiddenException,
} from '../../../../packages/http/src/index.js'
import type { CanActivate, ExecutionContext } from '../../../../packages/http/src/bridge/execution-context.js'
import { taskStore } from '../routes/tasks/_store.js'
import { TimingInterceptor } from '../interceptors/timing.interceptor.js'

// ─── Authorization — RBAC with @Roles() ─────────────────────

enum Role {
  User = 'user',
  Admin = 'admin',
}

const Roles = createDecorator<Role[]>()
const IsPublic = createDecorator<boolean>()
const reflector = new Reflector()

/**
 * NestJS-style RolesGuard with ExecutionContext + Reflector.
 * Reads @Roles() metadata from handler, falls back to class-level.
 * @IsPublic(true) skips auth entirely.
 */
class RolesGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    // Check if route is public
    const isPublic = reflector.getAllAndOverride(
      IsPublic,
      context.getClass(),
      context.getMethodName(),
    )
    if (isPublic) return true

    const roles = reflector.getAllAndOverride(
      Roles,
      context.getClass(),
      context.getMethodName(),
    )
    if (!roles) return true

    const req = context.getRequest()
    const userRole = req.headers.get('x-role')
    if (!userRole) return false
    return roles.some((role) => role === userRole)
  }
}

// ─── Zod schemas ─────────────────────────────────────────────

const zCreateTask = z.object({
  title: z.string().min(3, 'Title must be at least 3 characters'),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
})

// ─── Controller ──────────────────────────────────────────────

@UseGuards(RolesGuard)
@UseInterceptors(TimingInterceptor)
@Roles([Role.User]) // default: any authenticated user
@Controller('api/v2/tasks')
export class TasksController {
  @Get()
  @IsPublic(true) // override: list is public
  findAll() {
    return taskStore.findAll()
  }

  @Get('search')
  @IsPublic(true)
  search(@Query('q') q: string) {
    return taskStore
      .findAll()
      .filter((t) => t.title.toLowerCase().includes((q ?? '').toLowerCase()))
  }

  @Get(':id')
  @IsPublic(true)
  findById(@Param('id') id: string) {
    const task = taskStore.findById(id)
    if (!task) throw new NotFoundException(`Task ${id} not found`)
    return task
  }

  @Post()
  create(@Body(zCreateTask) body: z.infer<typeof zCreateTask>) {
    return taskStore.create(body)
  }

  @Post(':id/complete')
  complete(@Param('id') id: string) {
    const task = taskStore.complete(id)
    if (!task) throw new NotFoundException(`Task ${id} not found`)
    return task
  }

  @Delete(':id')
  @HttpCode(204)
  @Roles([Role.Admin]) // stricter: only admin can delete
  remove(@Param('id') id: string) {
    taskStore.remove(id)
  }

  @Get('stats')
  @IsPublic(true)
  stats() {
    return taskStore.stats()
  }
}
