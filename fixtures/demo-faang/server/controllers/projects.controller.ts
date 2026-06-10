import 'reflect-metadata'
import { z } from 'zod'
import {
  Controller, Get, Post, Put, Delete,
  Body, Param, HttpCode,
  UseGuards, UseInterceptors, UseFilters,
  NotFoundException,
} from '../../../../packages/http-decorators/src/index.js'
import { store } from '../store.js'
import { RolesGuard, Roles, Role, IsPublic } from '../guards/roles.guard.js'
import { TimingInterceptor } from '../interceptors/timing.interceptor.js'
import { HttpErrorFilter } from '../filters/http-error.filter.js'

const zCreateProject = z.object({
  name: z.string().min(2),
  description: z.string().optional(),
})

@Controller('api/projects')
@UseGuards(RolesGuard)
@UseInterceptors(TimingInterceptor)
@UseFilters(HttpErrorFilter)
@Roles([Role.User])
export class ProjectsController {
  @Get()
  @IsPublic(true)
  list() {
    return store.listProjects()
  }

  @Get('stats')
  @IsPublic(true)
  stats() {
    return store.stats()
  }

  @Get(':id')
  @IsPublic(true)
  findById(@Param('id') id: string) {
    const project = store.getProject(Number(id))
    if (!project) throw new NotFoundException(`Project ${id} not found`)
    return project
  }

  @Get(':id/tasks')
  @IsPublic(true)
  listTasks(@Param('id') id: string) {
    const project = store.getProject(Number(id))
    if (!project) throw new NotFoundException(`Project ${id} not found`)
    return store.listTasks(Number(id))
  }

  @Post()
  @Roles([Role.Admin])
  create(@Body(zCreateProject) body: z.infer<typeof zCreateProject>) {
    return store.createProject(body)
  }

  @Put(':id')
  @Roles([Role.Admin])
  update(@Param('id') id: string, @Body(zCreateProject) body: z.infer<typeof zCreateProject>) {
    const project = store.updateProject(Number(id), body)
    if (!project) throw new NotFoundException(`Project ${id} not found`)
    return project
  }

  @Delete(':id')
  @HttpCode(204)
  @Roles([Role.Admin])
  remove(@Param('id') id: string) {
    if (!store.deleteProject(Number(id))) throw new NotFoundException(`Project ${id} not found`)
  }
}
