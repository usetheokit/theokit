import 'reflect-metadata'
import { z } from 'zod'
import { Controller, Get, Post, Put, Patch, Delete, Body, Param, Query, HttpCode } from '@theokit/http'
import { taskStore } from '../store.js'

const zCreateTask = z.object({
  title: z.string().min(3),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
})

@Controller('api/v2/tasks')
export class TasksController {
  @Get()
  list() { return taskStore.list() }

  @Get('search')
  search(@Query('q') q: string) { return taskStore.search(q ?? '') }

  @Get(':id')
  findById(@Param('id') id: string) { return taskStore.get(Number(id)) }

  @Post()
  create(@Body(zCreateTask) body: z.infer<typeof zCreateTask>) {
    return taskStore.create(body)
  }

  @Put(':id')
  replace(@Param('id') id: string, @Body(zCreateTask) body: z.infer<typeof zCreateTask>) {
    return { id: Number(id), ...body }
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body(z.object({ done: z.boolean() })) body: { done: boolean }) {
    return taskStore.update(Number(id), body)
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string) { taskStore.remove(Number(id)) }
}
