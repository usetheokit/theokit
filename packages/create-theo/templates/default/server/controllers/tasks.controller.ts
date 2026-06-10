/**
 * TasksController — CRUD API for tasks.
 *
 * Demonstrates: @Controller, @Get/@Post/@Delete, @Body with Zod,
 * @Param, @Query, @HttpCode, @UseGuards, @Roles, @IsPublic,
 * @UseInterceptors, @UseFilters, NotFoundException.
 */
import 'reflect-metadata'
import { z } from 'zod'
import {
  Controller, Get, Post, Put, Delete,
  Body, Param, Query, HttpCode,
  UseGuards, UseInterceptors, UseFilters,
  NotFoundException,
} from '@theokit/http-decorators'
import { RolesGuard, Roles, Role, IsPublic } from '../guards/auth.guard.js'
import { TimingInterceptor } from '../interceptors/timing.interceptor.js'
import { HttpErrorFilter } from '../filters/http-error.filter.js'
import { taskStore } from '../store.js'

const zCreateTask = z.object({
  title: z.string().min(3, 'Title must be at least 3 characters'),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
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
    return taskStore.list()
  }

  @Get('search')
  @IsPublic(true)
  search(@Query('q') q: string) {
    return taskStore.search(q ?? '')
  }

  @Get(':id')
  @IsPublic(true)
  findById(@Param('id') id: string) {
    const task = taskStore.get(Number(id))
    if (!task) throw new NotFoundException(`Task ${id} not found`)
    return task
  }

  @Post()
  create(@Body(zCreateTask) body: z.infer<typeof zCreateTask>) {
    return taskStore.create(body)
  }

  @Put(':id')
  update(@Param('id') id: string, @Body(z.object({ done: z.boolean() })) body: { done: boolean }) {
    const task = taskStore.update(Number(id), body)
    if (!task) throw new NotFoundException(`Task ${id} not found`)
    return task
  }

  @Delete(':id')
  @HttpCode(204)
  @Roles([Role.Admin])
  remove(@Param('id') id: string) {
    if (!taskStore.remove(Number(id))) throw new NotFoundException(`Task ${id} not found`)
  }
}
