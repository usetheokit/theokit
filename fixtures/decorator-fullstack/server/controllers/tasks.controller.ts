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
  UseInterceptors,
  NotFoundException,
} from '../../../../packages/http-decorators/src/index.js'
import { taskStore } from '../routes/tasks/_store.js'
import { TimingInterceptor } from '../interceptors/timing.interceptor.js'

/**
 * Zod schema — single source of truth for task creation validation.
 * Passed directly to @Body(zCreateTask) — no design:paramtypes needed.
 * This is the TheoKit-canonical pattern: "Zod is SSoT".
 */
const zCreateTask = z.object({
  title: z.string().min(3, 'Title must be at least 3 characters'),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
})

@UseInterceptors(TimingInterceptor)
@Controller('api/v2/tasks')
export class TasksController {
  @Get()
  findAll() {
    return taskStore.findAll()
  }

  @Get('search')
  search(@Query('q') q: string) {
    return taskStore
      .findAll()
      .filter((t) => t.title.toLowerCase().includes((q ?? '').toLowerCase()))
  }

  @Get(':id')
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
  remove(@Param('id') id: string) {
    taskStore.remove(id)
  }

  @Get('stats')
  stats() {
    return taskStore.stats()
  }
}
