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
} from '../../../../packages/http-decorators/src/index.js'
import { taskStore } from '../routes/tasks/_store.js'
import { AuthGuard } from '../guards/auth.guard.js'

/**
 * Zod schema — single source of truth for task creation validation.
 * Passed directly to @Body(zCreateTask) — no design:paramtypes needed.
 * This is the TheoKit-canonical pattern: "Zod is SSoT".
 */
const zCreateTask = z.object({
  title: z.string().min(3, 'Title must be at least 3 characters'),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
})

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
    return taskStore.findById(id) ?? { error: 'Task not found' }
  }

  @Post()
  create(@Body(zCreateTask) body: z.infer<typeof zCreateTask>) {
    return taskStore.create(body)
  }

  @Post(':id/complete')
  complete(@Param('id') id: string) {
    return taskStore.complete(id) ?? { error: 'Task not found' }
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string) {
    taskStore.remove(id)
  }

  @Get('stats')
  @UseGuards(AuthGuard)
  stats() {
    return taskStore.stats()
  }
}
