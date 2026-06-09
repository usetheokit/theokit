/**
 * TheoKit configuration — theo.config.ts
 *
 * This is the ONLY file where you wire decorators into TheoKit.
 * One line: httpDecoratorsPlugin({ controllers, container })
 */
// import { defineConfig } from 'theokit/server'
// import { httpDecoratorsPlugin } from '@theokit/http-decorators/theokit-plugin'
// import { Container } from '@theokit/di'

import { TasksController } from './server/controllers/tasks.controller.js'
import { HealthController } from './server/controllers/health.controller.js'
import { TaskService } from './server/services/task.service.js'

/**
 * In a real TheoKit app, this would be:
 *
 * export default defineConfig({
 *   plugins: [
 *     httpDecoratorsPlugin({
 *       controllers: [TasksController, HealthController],
 *       container,  // @theokit/di Container with registered services
 *     })
 *   ]
 * })
 *
 * The plugin registers an onRequest hook that intercepts HTTP requests
 * matching decorator-defined routes BEFORE TheoKit's file-based scanner.
 * Both styles (decorators + defineRoute files) coexist in the same app.
 */

// For this standalone example, we export the config for the demo runner
export const controllers = [TasksController, HealthController]
export const services = { TaskService }
