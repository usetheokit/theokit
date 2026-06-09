/**
 * server/main.ts — Application bootstrap
 *
 * NestJS:  const app = await NestFactory.create(AppModule); app.listen(3000)
 * Spring:  SpringApplication.run(AppClass.class)
 * TheoKit: TheoApp.create({ controllers, providers }).listen(3000)
 */
import 'reflect-metadata'
import { TheoApp } from '@theokit/http-decorators'

import { TasksController } from './controllers/tasks.controller.js'
import { HealthController } from './controllers/health.controller.js'
import { TaskService } from './services/task.service.js'

const app = TheoApp.create({
  controllers: [TasksController, HealthController],
  providers: [TaskService],
})

app.listen(3000)
