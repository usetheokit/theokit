import 'reflect-metadata'
import { z } from 'zod'
import {
  Controller, Get, Post, Put, Delete,
  Body, Param, Query, HttpCode,
  UseGuards, UseInterceptors, UseFilters,
  NotFoundException,
} from '../../../../packages/http/src/index.js'
import { store } from '../store.js'
import { RolesGuard, Roles, Role, IsPublic } from '../guards/roles.guard.js'
import { TimingInterceptor } from '../interceptors/timing.interceptor.js'
import { HttpErrorFilter } from '../filters/http-error.filter.js'

const zCreateTask = z.object({
  projectId: z.number(),
  title: z.string().min(3),
  priority: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
  assignee: z.string().optional(),
})

const zUpdateTask = z.object({
  title: z.string().min(3).optional(),
  priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  status: z.enum(['todo', 'in-progress', 'done']).optional(),
  assignee: z.string().optional(),
})

@Controller('api/tasks')
@UseGuards(RolesGuard)
@UseInterceptors(TimingInterceptor)
@UseFilters(HttpErrorFilter)
@Roles([Role.User])
export class TasksController {
  @Get()
  @IsPublic(true)
  list() {
    return store.listTasks()
  }

  @Get('search')
  @IsPublic(true)
  search(@Query('q') q: string) {
    return store.searchTasks(q ?? '')
  }

  @Get(':id')
  @IsPublic(true)
  findById(@Param('id') id: string) {
    const task = store.getTask(Number(id))
    if (!task) throw new NotFoundException(`Task ${id} not found`)
    return task
  }

  @Post()
  create(@Body(zCreateTask) body: z.infer<typeof zCreateTask>) {
    return store.createTask(body)
  }

  @Put(':id')
  update(@Param('id') id: string, @Body(zUpdateTask) body: z.infer<typeof zUpdateTask>) {
    const task = store.updateTask(Number(id), body)
    if (!task) throw new NotFoundException(`Task ${id} not found`)
    return task
  }

  @Delete(':id')
  @HttpCode(204)
  @Roles([Role.Admin])
  remove(@Param('id') id: string) {
    if (!store.getTask(Number(id))) throw new NotFoundException(`Task ${id} not found`)
  }
}
