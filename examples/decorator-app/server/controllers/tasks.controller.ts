import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  Header,
  UseGuards,
} from '@theokit/http-decorators'

import { TaskService } from '../services/task.service.js'
import { AuthGuard } from '../guards/auth.guard.js'
import { CreateTaskDto, type CreateTask } from '../dto/create-task.dto.js'

/**
 * TasksController — HTTP API for task management.
 *
 * NestJS-style decorators bridge to TheoKit's defineRoute + defineMiddleware.
 * TaskService is injected via constructor DI (from @theokit/di Container).
 */
@Controller('tasks')
export class TasksController {
  constructor(private taskService: TaskService) {}

  /**
   * GET /tasks — list all tasks
   */
  @Get()
  @Header('X-App', 'theokit-decorator-app')
  findAll() {
    return this.taskService.findAll()
  }

  /**
   * GET /tasks/search?q=query — search tasks by title
   */
  @Get('search')
  search(@Query('q') query: string) {
    return this.taskService.search(query)
  }

  /**
   * GET /tasks/:id — get a single task
   */
  @Get(':id')
  findById(@Param('id') id: string) {
    const task = this.taskService.findById(id)
    if (!task) return { error: 'Task not found' }
    return task
  }

  /**
   * POST /tasks — create a new task
   * Body validated by Zod via CreateTaskDto.schema
   */
  @Post()
  create(@Body() body: CreateTaskDto) {
    return this.taskService.create(body as CreateTask)
  }

  /**
   * POST /tasks/:id/complete — mark task as done
   */
  @Post(':id/complete')
  complete(@Param('id') id: string) {
    const task = this.taskService.complete(id)
    if (!task) return { error: 'Task not found' }
    return task
  }

  /**
   * DELETE /tasks/:id — remove a task (204 No Content)
   */
  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string) {
    this.taskService.remove(id)
  }

  /**
   * GET /tasks/stats — task statistics (protected by AuthGuard)
   * Requires: Authorization: Bearer theokit-token
   */
  @Get('stats')
  @UseGuards(AuthGuard)
  getStats() {
    return this.taskService.stats()
  }
}
