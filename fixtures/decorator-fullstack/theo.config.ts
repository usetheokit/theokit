import { defineConfig } from 'theokit'
import { httpDecoratorsPlugin } from '../../packages/http-decorators/src/theokit-plugin.js'
import { TasksController } from './server/controllers/tasks.controller.js'

export default defineConfig({
  plugins: [
    httpDecoratorsPlugin({
      controllers: [TasksController],
    }),
  ],
})
