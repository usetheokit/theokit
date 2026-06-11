/**
 * Server module — auto-exports all controllers, agents, and providers.
 *
 * Convention: add your classes here. TheoApp.create() imports this one file.
 * Like Rails' application.rb — single entry point for the backend.
 *
 * When you run `theokit generate controller/agent/toolbox`, the generated
 * file is auto-added here.
 */

// Controllers — HTTP API
export { TasksController } from './controllers/tasks.controller.js'

// Agents — AI endpoints
export { AssistantAgent } from './agents/assistant.agent.js'

// Providers — DI (toolboxes, services)
export { TaskTools } from './toolboxes/task.tools.js'
