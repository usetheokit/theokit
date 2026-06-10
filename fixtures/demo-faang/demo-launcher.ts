#!/usr/bin/env npx tsx
/**
 * TheoKit FAANG Demo — AI-Powered Project Manager
 *
 * Proves: HTTP controllers + AI agents + tools + RBAC + SSE streaming + observability
 * ALL share the SAME pipeline (guards, interceptors, filters, throttle).
 *
 * Controllers loaded via SWC (parameter decorators require legacy decorator support).
 */
import { resolve } from 'node:path'
import { loadControllerWithSwc } from '../../packages/http-decorators/src/bridge/swc-loader.js'
import { createDecoratorServer } from '../../packages/http-decorators/src/bridge/create-server.js'
import { walkAgentMetadata } from '../../packages/agents/src/bridge/walk-agent-metadata.js'
import { compileAgent } from '../../packages/agents/src/bridge/agent-compiler.js'
import { generateAgentRoutes } from '../../packages/agents/src/bridge/agent-route-generator.js'
import { getMixins } from '../../packages/agents/src/decorators/mixin.js'
import { generateAgentManifest } from '../../packages/agents/src/manifest/agent-manifest.js'
import type { StreamEvent } from '../../packages/agents/src/bridge/agent-sse-handler.js'

// Middleware (no parameter decorators — tsx/esbuild handles fine)
import { LoggerMiddleware } from './server/middleware/logger.middleware.js'

const PORT = Number(process.env.PORT ?? 4000)

async function main() {
  // Load controllers + agent + toolbox via SWC (parameter decorators)
  const dir = import.meta.dirname!
  const [projectsMod, tasksMod, agentMod, toolsMod] = await Promise.all([
    loadControllerWithSwc(resolve(dir, 'server/controllers/projects.controller.ts')),
    loadControllerWithSwc(resolve(dir, 'server/controllers/tasks.controller.ts')),
    loadControllerWithSwc(resolve(dir, 'server/agents/planner.agent.ts')),
    loadControllerWithSwc(resolve(dir, 'server/toolboxes/project.tools.ts')),
  ])

  const ProjectsController = projectsMod.ProjectsController as Function
  const TasksController = tasksMod.TasksController as Function
  const PlannerAgent = agentMod.PlannerAgent as Function
  const ProjectTools = toolsMod.ProjectTools as new () => object

  // Walk agent metadata
  const mixins = getMixins(PlannerAgent)
  const agentWalk = walkAgentMetadata(PlannerAgent, [...mixins, ProjectTools])
  // Map toolbox classes to instances — use the SAME class ref from walkResult
  const toolboxInstances = new Map<Function, object>()
  for (const tb of agentWalk.toolboxes) {
    toolboxInstances.set(tb.class, new (tb.class as new () => object)())
  }
  const compiled = compileAgent(agentWalk, toolboxInstances)
  const manifest = generateAgentManifest([agentWalk])

// ─── REAL LLM Agent Runner (replaces mock stream) ──────────

const { createRealAgentStream } = await import('./server/llm-agent-runner.js')

const apiKey = process.env.OPENROUTER_API_KEY ?? ''
const llmModel = process.env.LLM_MODEL ?? 'openai/gpt-4o-mini'

if (!apiKey) {
  console.warn('\n  ⚠️  OPENROUTER_API_KEY not set — agent will return error.\n  Set: export OPENROUTER_API_KEY="sk-or-v1-..."')
}

const createRun = createRealAgentStream(agentWalk, compiled.tools, apiKey, llmModel)

// ─── Generate agent routes ──────────────────────────────────

const agentRoutes = generateAgentRoutes({
  walkResult: agentWalk,
  compiledOptions: compiled,
  createRun,
})

// ─── Create unified HTTP server (controllers + agent routes) ────

const { createNodeAdapter } = await import('../../packages/http-decorators/src/bridge/runtime/node.js')
const walkMetaMod = await import('../../packages/http-decorators/src/bridge/walk-metadata.js')
const { runMiddleware, MiddlewareConsumerImpl } = await import('../../packages/http-decorators/src/bridge/middleware-consumer.js')
const { createExecutionContext } = await import('../../packages/http-decorators/src/bridge/execution-context.js')
const { runInterceptors } = await import('../../packages/http-decorators/src/bridge/interceptor-chain.js')
const { runExceptionFilters } = await import('../../packages/http-decorators/src/bridge/exception-filter-chain.js')
const { ForbiddenException } = await import('../../packages/http-decorators/src/exceptions/http-exception.js')
const walkControllerMetadata = walkMetaMod.walkControllerMetadata

// Build controller routes
const controllers = [ProjectsController, TasksController]
const controllerRoutes: { walk: any; instance: object }[] = []
for (const Ctor of controllers) {
  const instance = new (Ctor as new () => object)()
  const walks = walkControllerMetadata(Ctor)
  for (const w of walks) controllerRoutes.push({ walk: w, instance })
}
controllerRoutes.sort((a, b) => {
  const aP = a.walk.fullPath.includes(':')
  const bP = b.walk.fullPath.includes(':')
  return aP === bP ? 0 : aP ? 1 : -1
})

// Middleware
const mwConsumer = new MiddlewareConsumerImpl()
mwConsumer.apply(LoggerMiddleware).forRoutes('*')
const mwEntries = mwConsumer.getEntries()

// Unified handler: agent routes → controller routes → 404
const adapter = createNodeAdapter()
const handle = adapter.createServer(async (request: Request): Promise<Response> => {
  const url = new URL(request.url)
  const method = request.method.toUpperCase()

  // 0. Frontend HTML
  if (method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    return new Response(FRONTEND_HTML, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } })
  }

  // 1. Agent routes
  for (const route of agentRoutes) {
    if (method === route.method) {
      const pattern = route.path.replace(/:[^/]+/g, '[^/]+')
      if (new RegExp(`^${pattern}$`).test(url.pathname)) {
        return route.handler(request)
      }
    }
  }

  // 2. Middleware
  const mwRes = await runMiddleware(mwEntries, request, url.pathname)
  if (mwRes) return mwRes

  // 3. Controller routes
  for (const { walk, instance } of controllerRoutes) {
    if (walk.verb !== 'ALL' && walk.verb !== method) continue
    const paramNames: string[] = []
    const regexStr = walk.fullPath.replace(/:(\w+)/g, (_m: string, name: string) => { paramNames.push(name); return '([^/]+)' })
    const match = url.pathname.match(new RegExp(`^${regexStr}$`))
    if (!match) continue

    const params: Record<string, string> = {}
    paramNames.forEach((name, i) => { params[name] = match[i + 1] })

    try {
      // Guards
      const ctx = createExecutionContext(request, instance.constructor, walk.propertyKey)
      for (const GuardCtor of walk.guards) {
        const guard = new (GuardCtor as new () => { canActivate: (c: any) => boolean })()
        if (!guard.canActivate(ctx)) {
          const ex = new ForbiddenException('Forbidden resource')
          return new Response(JSON.stringify(ex.toJSON()), { status: ex.statusCode, headers: { 'content-type': 'application/json' } })
        }
      }

      // Body
      let body: unknown
      if (['POST', 'PUT', 'PATCH'].includes(method)) {
        try { body = JSON.parse(await request.text()) } catch { /* empty */ }
        if (walk.bodySchema && body) {
          const result = walk.bodySchema.safeParse(body)
          if (!result.success) return new Response(JSON.stringify({ error: { code: 'VALIDATION_ERROR', issues: result.error.issues } }), { status: 422, headers: { 'content-type': 'application/json' } })
          body = result.data
        }
      }

      // Build args
      const args: unknown[] = []
      for (const p of walk.paramEntries.sort((a: any, b: any) => a.index - b.index)) {
        if (p.source === 'body') args[p.index] = p.key ? (body as any)?.[p.key] : body
        else if (p.source === 'param') args[p.index] = p.key ? params[p.key] : params
        else if (p.source === 'query') args[p.index] = p.key ? url.searchParams.get(p.key) : Object.fromEntries(url.searchParams)
        else if (p.source === 'req') args[p.index] = request
        else if (p.source === 'headers') args[p.index] = p.key ? request.headers.get(p.key) : Object.fromEntries(request.headers)
      }

      // Handler
      const handlerFn = (instance as any)[walk.propertyKey]
      const result = await runInterceptors(walk.interceptors, () => handlerFn.apply(instance, args), request)

      // Response
      const status = walk.status ?? (method === 'POST' ? 201 : 200)
      if (result === undefined || result === null) return new Response(null, { status: status === 200 ? 204 : status })
      return new Response(JSON.stringify(result), { status, headers: { 'content-type': 'application/json' } })
    } catch (err) {
      return runExceptionFilters(err, walk.filters, request)
    }
  }

  return new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: `No route for ${method} ${url.pathname}` } }), { status: 404, headers: { 'content-type': 'application/json' } })
})

handle.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║  TheoKit FAANG Demo — AI-Powered Project Manager                   ║
║  Framework: HTTP Controllers + AI Agents + Unified Pipeline        ║
╠══════════════════════════════════════════════════════════════════════╣
║                                                                    ║
║  Server: http://localhost:${PORT}                                     ║
║                                                                    ║
║  ┌──────────────────────────────────────────────────────────────┐  ║
║  │ HTTP CONTROLLERS (@Controller)              AUTH             │  ║
║  │  GET  /api/projects                         @IsPublic       │  ║
║  │  GET  /api/projects/:id                     @IsPublic       │  ║
║  │  GET  /api/projects/:id/tasks               @IsPublic       │  ║
║  │  GET  /api/projects/stats                   @IsPublic       │  ║
║  │  POST /api/projects                         @Roles([Admin]) │  ║
║  │  PUT  /api/projects/:id                     @Roles([Admin]) │  ║
║  │  DEL  /api/projects/:id                     @Roles([Admin]) │  ║
║  │  GET  /api/tasks                            @IsPublic       │  ║
║  │  GET  /api/tasks/search?q=                  @IsPublic       │  ║
║  │  POST /api/tasks                            @Roles([User])  │  ║
║  │  PUT  /api/tasks/:id                        @Roles([User])  │  ║
║  │  DEL  /api/tasks/:id                        @Roles([Admin]) │  ║
║  └──────────────────────────────────────────────────────────────┘  ║
║                                                                    ║
║  ┌──────────────────────────────────────────────────────────────┐  ║
║  │ AI AGENT (@Agent)                                           │  ║
║  │  POST /api/agents/planner/chat   SSE stream  @Roles([User]) │  ║
║  │                                                             │  ║
║  │  Model: claude-sonnet-4-5-20250929                          │  ║
║  │  Strategy: react (max 8 iterations)                         │  ║
║  │  Tools: project.list_tasks, project.create_task,            │  ║
║  │         project.search_tasks, project.prioritize_tasks,     │  ║
║  │         project.update_task_status, project.get_stats       │  ║
║  │  Budget: $1.00/day  |  Memory: per-user  |  Checkpoint: on  │  ║
║  └──────────────────────────────────────────────────────────────┘  ║
║                                                                    ║
║  SHARED PIPELINE (same for controllers AND agents):                ║
║    ✓ LoggerMiddleware (request logging)                            ║
║    ✓ RolesGuard + @Roles + @IsPublic (RBAC authorization)         ║
║    ✓ TimingInterceptor (execution timing)                          ║
║    ✓ HttpErrorFilter (custom error responses)                      ║
║    ✓ @Throttle (rate limiting)                                     ║
║    ✓ Zod validation (@Body with schema)                            ║
║    ✓ Exception hierarchy (NotFoundException → 404)                 ║
║                                                                    ║
║  AGENT MANIFEST (${manifest.agents[0].tools.length} tools registered):                            ║
${manifest.agents[0].tools.map(t => `║    • ${t.name.padEnd(35)} risk: ${(t.risk ?? 'low').padEnd(8)} ${t.approval ? '🔒 approval' : ''}  ║`).join('\n')}
║                                                                    ║
╚══════════════════════════════════════════════════════════════════════╝

  Try:
    curl localhost:${PORT}/api/projects
    curl localhost:${PORT}/api/projects/stats
    curl -X POST localhost:${PORT}/api/projects -H "Content-Type: application/json" -H "x-role: admin" -d '{"name":"New Project"}'
    curl localhost:${PORT}/api/tasks/search?q=web
    curl -N -X POST localhost:${PORT}/api/agents/planner/chat -H "Content-Type: application/json" -H "x-role: user" -d '{"message":"What tasks are in project 1?"}'
`)
  })
}

// ─── Frontend HTML (self-contained — no build step) ─────────

const FRONTEND_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>TheoKit FAANG Demo — AI Project Manager</title>
<style>
  :root { --bg: #0a0a0a; --card: #141414; --border: #2a2a2a; --text: #e0e0e0; --muted: #888; --accent: #6366f1; --green: #22c55e; --red: #ef4444; --yellow: #eab308; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: var(--bg); color: var(--text); min-height: 100vh; }
  .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
  h1 { font-size: 1.8rem; margin-bottom: 4px; }
  h1 span { color: var(--accent); }
  .subtitle { color: var(--muted); margin-bottom: 24px; font-size: 0.9rem; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
  @media (max-width: 768px) { .grid { grid-template-columns: 1fr; } }
  .card { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 20px; }
  .card h2 { font-size: 1.1rem; margin-bottom: 12px; display: flex; align-items: center; gap: 8px; }
  .badge { font-size: 0.7rem; padding: 2px 8px; border-radius: 99px; font-weight: 600; }
  .badge-green { background: #22c55e22; color: var(--green); }
  .badge-yellow { background: #eab30822; color: var(--yellow); }
  .badge-red { background: #ef444422; color: var(--red); }
  .badge-blue { background: #6366f122; color: var(--accent); }
  table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
  th { text-align: left; padding: 8px 6px; color: var(--muted); border-bottom: 1px solid var(--border); font-weight: 500; }
  td { padding: 8px 6px; border-bottom: 1px solid var(--border); }
  .status { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; }
  .status-done { background: var(--green); }
  .status-in-progress { background: var(--yellow); }
  .status-todo { background: var(--muted); }
  .chat-container { display: flex; flex-direction: column; height: 500px; }
  .chat-messages { flex: 1; overflow-y: auto; padding: 12px; background: #0d0d0d; border-radius: 8px; margin-bottom: 12px; font-size: 0.85rem; line-height: 1.6; }
  .msg { margin-bottom: 12px; }
  .msg-user { color: var(--accent); }
  .msg-agent { color: var(--text); }
  .msg-tool { color: var(--yellow); font-size: 0.8rem; font-family: monospace; }
  .msg-system { color: var(--muted); font-size: 0.8rem; font-style: italic; }
  .chat-input { display: flex; gap: 8px; }
  .chat-input input { flex: 1; padding: 10px 14px; background: #1a1a1a; border: 1px solid var(--border); border-radius: 8px; color: var(--text); font-size: 0.9rem; outline: none; }
  .chat-input input:focus { border-color: var(--accent); }
  .chat-input button { padding: 10px 20px; background: var(--accent); color: white; border: none; border-radius: 8px; cursor: pointer; font-weight: 600; }
  .chat-input button:disabled { opacity: 0.5; cursor: not-allowed; }
  .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 20px; }
  .stat { text-align: center; padding: 16px; background: #1a1a1a; border-radius: 8px; }
  .stat-value { font-size: 1.8rem; font-weight: 700; }
  .stat-label { font-size: 0.75rem; color: var(--muted); margin-top: 4px; }
  .pipeline { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 12px; }
  .pipe-step { font-size: 0.7rem; padding: 4px 10px; background: #1a1a1a; border-radius: 6px; color: var(--muted); }
  .pipe-arrow { color: var(--muted); line-height: 26px; }
  .role-select { padding: 6px 12px; background: #1a1a1a; border: 1px solid var(--border); border-radius: 6px; color: var(--text); font-size: 0.8rem; margin-bottom: 12px; }
  .create-form { display: flex; gap: 8px; margin-top: 12px; }
  .create-form input { flex: 1; padding: 8px 12px; background: #1a1a1a; border: 1px solid var(--border); border-radius: 6px; color: var(--text); font-size: 0.85rem; }
  .create-form button { padding: 8px 16px; background: var(--green); color: #000; border: none; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 0.85rem; }
  .error { color: var(--red); font-size: 0.8rem; margin-top: 4px; }
</style>
</head>
<body>
<div class="container">
  <h1><span>TheoKit</span> FAANG Demo</h1>
  <p class="subtitle">HTTP Controllers + AI Agents + Unified Pipeline — same guards, interceptors, filters</p>

  <div class="stats" id="stats"></div>

  <div style="margin-bottom:12px">
    <label style="color:var(--muted);font-size:0.8rem">Simulate role: </label>
    <select class="role-select" id="role">
      <option value="">No role (public only)</option>
      <option value="user" selected>User</option>
      <option value="admin">Admin</option>
    </select>
    <span class="pipeline">
      <span class="pipe-step">Middleware</span><span class="pipe-arrow">→</span>
      <span class="pipe-step">Guards</span><span class="pipe-arrow">→</span>
      <span class="pipe-step">Interceptors</span><span class="pipe-arrow">→</span>
      <span class="pipe-step">Handler</span><span class="pipe-arrow">→</span>
      <span class="pipe-step">Filters</span>
    </span>
  </div>

  <div class="grid">
    <div class="card">
      <h2>📋 Projects <span class="badge badge-blue">@Controller</span></h2>
      <table><thead><tr><th>ID</th><th>Name</th><th>Description</th></tr></thead><tbody id="projects"></tbody></table>
      <div class="create-form">
        <input id="newProject" placeholder="New project name..." />
        <button onclick="createProject()">Create</button>
      </div>
      <div class="error" id="projectError"></div>

      <h2 style="margin-top:20px">📝 Tasks <span class="badge badge-green">@Controller</span></h2>
      <table><thead><tr><th>Title</th><th>Priority</th><th>Status</th></tr></thead><tbody id="tasks"></tbody></table>
    </div>

    <div class="card">
      <h2>🤖 AI Planner Agent <span class="badge badge-yellow">@Agent + SSE</span></h2>
      <div class="chat-container">
        <div class="chat-messages" id="chat">
          <div class="msg msg-system">Agent ready. Ask about projects, tasks, priorities...</div>
        </div>
        <div class="chat-input">
          <input id="chatInput" placeholder="Ask the AI planner..." onkeydown="if(event.key==='Enter')sendChat()" />
          <button id="chatBtn" onclick="sendChat()">Send</button>
        </div>
      </div>
    </div>
  </div>
</div>

<script>
const API = '';
const getRole = () => document.getElementById('role').value;
const headers = () => {
  const h = { 'Content-Type': 'application/json' };
  const role = getRole();
  if (role) h['x-role'] = role;
  return h;
};

async function loadStats() {
  const res = await fetch(API + '/api/projects/stats');
  const s = await res.json();
  document.getElementById('stats').innerHTML =
    '<div class="stat"><div class="stat-value">' + s.totalProjects + '</div><div class="stat-label">Projects</div></div>' +
    '<div class="stat"><div class="stat-value">' + s.totalTasks + '</div><div class="stat-label">Tasks</div></div>' +
    '<div class="stat"><div class="stat-value" style="color:var(--green)">' + s.byStatus.done + '</div><div class="stat-label">Done</div></div>' +
    '<div class="stat"><div class="stat-value" style="color:var(--yellow)">' + s.byStatus['in-progress'] + '</div><div class="stat-label">In Progress</div></div>';
}

async function loadProjects() {
  const res = await fetch(API + '/api/projects');
  const projects = await res.json();
  document.getElementById('projects').innerHTML = projects.map(p =>
    '<tr><td>' + p.id + '</td><td>' + p.name + '</td><td style="color:var(--muted)">' + (p.description || '—') + '</td></tr>'
  ).join('');
}

async function loadTasks() {
  const res = await fetch(API + '/api/tasks');
  const tasks = await res.json();
  document.getElementById('tasks').innerHTML = tasks.map(t => {
    const sc = t.status === 'done' ? 'done' : t.status === 'in-progress' ? 'in-progress' : 'todo';
    const pc = t.priority === 'critical' ? 'red' : t.priority === 'high' ? 'yellow' : 'green';
    return '<tr><td><span class="status status-' + sc + '"></span>' + t.title + '</td><td><span class="badge badge-' + pc + '">' + t.priority + '</span></td><td>' + t.status + '</td></tr>';
  }).join('');
}

async function createProject() {
  const name = document.getElementById('newProject').value.trim();
  if (!name) return;
  const err = document.getElementById('projectError');
  err.textContent = '';
  const res = await fetch(API + '/api/projects', { method: 'POST', headers: headers(), body: JSON.stringify({ name }) });
  if (res.status === 403) { err.textContent = '403 Forbidden — need Admin role'; return; }
  if (!res.ok) { const e = await res.json(); err.textContent = JSON.stringify(e.error || e); return; }
  document.getElementById('newProject').value = '';
  loadProjects(); loadStats();
}

async function sendChat() {
  const input = document.getElementById('chatInput');
  const msg = input.value.trim();
  if (!msg) return;
  input.value = '';

  const chat = document.getElementById('chat');
  chat.innerHTML += '<div class="msg msg-user">You: ' + msg + '</div>';
  document.getElementById('chatBtn').disabled = true;

  try {
    const res = await fetch(API + '/api/agents/planner/chat', {
      method: 'POST', headers: headers(), body: JSON.stringify({ message: msg })
    });

    if (res.status === 403) {
      chat.innerHTML += '<div class="msg msg-system">403 Forbidden — need User role to chat with agent</div>';
      document.getElementById('chatBtn').disabled = false;
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let agentDiv = document.createElement('div');
    agentDiv.className = 'msg msg-agent';
    agentDiv.textContent = 'Agent: ';
    chat.appendChild(agentDiv);

    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const event = JSON.parse(line.slice(6));
            if (event.type === 'text_delta') {
              agentDiv.textContent += event.content;
            } else if (event.type === 'tool_call') {
              chat.innerHTML += '<div class="msg msg-tool">🔧 Calling: ' + event.toolName + '</div>';
            } else if (event.type === 'tool_result') {
              chat.innerHTML += '<div class="msg msg-tool">✅ Result: ' + (event.output || '').substring(0, 100) + '...</div>';
            } else if (event.type === 'thinking') {
              chat.innerHTML += '<div class="msg msg-system">💭 ' + event.content + '</div>';
            } else if (event.type === 'done') {
              chat.innerHTML += '<div class="msg msg-system">✅ Done — ' + event.usage.totalTokens + ' tokens, ' + event.durationMs + 'ms</div>';
            }
          } catch {}
        }
      }
      chat.scrollTop = chat.scrollHeight;
    }
    loadTasks(); loadStats();
  } catch (e) {
    chat.innerHTML += '<div class="msg msg-system" style="color:var(--red)">Error: ' + e.message + '</div>';
  }
  document.getElementById('chatBtn').disabled = false;
  chat.scrollTop = chat.scrollHeight;
}

loadStats(); loadProjects(); loadTasks();
</script>
</body>
</html>`;

main().catch(console.error)
