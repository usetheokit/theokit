/**
 * TheoKit App — convention over configuration.
 *
 * TheoApp.create() auto-wires everything:
 *   Controllers → routes inferred from class name
 *   Agents → endpoints inferred from class name
 *   Providers → injected via DI
 *
 * Zero manual route mapping. Zero plumbing.
 */
import 'reflect-metadata'
import { readFileSync } from 'node:fs'
import { TheoApp } from '@theokit/http/app'
import { TasksController } from './server/controllers/tasks.controller.js'
import { AssistantAgent } from './server/agents/assistant.agent.js'
import { TaskTools } from './server/toolboxes/task.tools.js'

let html: string | undefined
try { html = readFileSync(new URL('./public/index.html', import.meta.url), 'utf-8') } catch { /* no frontend */ }

const app = await TheoApp.create({
  controllers: [TasksController],
  agents: [AssistantAgent],
  providers: [TaskTools],
  html,
  readinessChecks: [
    async () => ({ name: 'store', healthy: true }),
  ],
})

await app.listen(3000)
