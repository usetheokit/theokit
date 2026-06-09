/**
 * server/main.ts — Application bootstrap (Spring Boot style)
 *
 * NestJS:     const app = await NestFactory.create(AppModule); app.listen(3000)
 * Spring:     SpringApplication.run(AppClass.class)
 * TheoKit:    const app = await TheoApp.create(AppModule); app.listen(3000)
 *
 * That's it. No manual Container, no createDecoratorServer, no wiring.
 */
import 'reflect-metadata'
import { TheoApp, Module } from '@theokit/http-decorators'

import { TasksController } from './controllers/tasks.controller.js'
import { HealthController } from './controllers/health.controller.js'
import { TaskService } from './services/task.service.js'

@Module({
  controllers: [TasksController, HealthController],
  providers: [TaskService],
})
class AppModule {}

async function bootstrap() {
  const app = await TheoApp.create(AppModule)
  await app.listen(3000)
}

bootstrap()
