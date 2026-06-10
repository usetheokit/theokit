/**
 * TheoKit App — entry point.
 *
 * That's it. No manual wiring. No plumbing.
 * TheoApp.create() handles everything:
 *   - Controller routes (HTTP CRUD)
 *   - Agent routes (SSE streaming + tool calling)
 *   - DI (providers injected into controllers + agents)
 *   - Shared pipeline (guards, interceptors, filters)
 */
import 'reflect-metadata'
import { readFileSync } from 'node:fs'
import { TheoApp } from '@theokit/http-decorators/app'
import { TasksController } from './server/controllers/tasks.controller.js'
import { AssistantAgent } from './server/agents/assistant.agent.js'
import { TaskTools } from './server/toolboxes/task.tools.js'

// Frontend HTML (inline for alpha — upgrade to Vite plugin for React SSR)
let html: string | undefined
try { html = readFileSync(new URL('./public/index.html', import.meta.url), 'utf-8') } catch { /* no frontend */ }

const app = await TheoApp.create({
  controllers: [TasksController],
  agents: [AssistantAgent],
  providers: [TaskTools],
  html,
})

await app.listen(3000)
