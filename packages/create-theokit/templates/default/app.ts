/**
 * TheoKit App — convention over configuration.
 *
 * "The framework that reduces noise for humans + AI."
 *
 * Backend classes registered in server/index.ts (one barrel, like Rails).
 * Routes inferred from class names. Zero manual wiring.
 */
import 'reflect-metadata'
import { readFileSync } from 'node:fs'
import { TheoApp } from '@theokit/http/app'
import { TasksController, AssistantAgent, TaskTools } from './server/index.js'

let html: string | undefined
try { html = readFileSync(new URL('./public/index.html', import.meta.url), 'utf-8') } catch { /* no frontend */ }

const app = await TheoApp.create({
  controllers: [TasksController],
  agents: [AssistantAgent],
  providers: [TaskTools],
  html,
})

await app.listen(3000)
