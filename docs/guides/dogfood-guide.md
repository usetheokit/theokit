# Dogfood Guide — TheoKit End-to-End

Guia para o time testar o TheoKit como um usuario real faria. De `npx` ate HTTP request + agent com LLM real. Tempo total: ~15 minutos.

## Pre-requisitos

```bash
node -v   # >= 22.12.0
pnpm -v   # >= 9.0 (ou npm >= 10)
```

API key (qualquer uma funciona):
- OpenRouter: https://openrouter.ai/keys (gratis, multi-modelo)
- Anthropic: https://console.anthropic.com/settings/keys
- OpenAI: https://platform.openai.com/api-keys

---

## Fase 1 — Scaffold (2 min)

```bash
npx create-theokit@0.8.0 meu-app
cd meu-app
```

O scaffold cria um app completo com:

```
meu-app/
├── app/                          # Frontend (React)
│   ├── page.tsx                  # Pagina inicial
│   └── layout.tsx                # Layout raiz
├── server/                       # Backend (decorators)
│   ├── controllers/
│   │   └── tasks.controller.ts   # CRUD com @Controller/@Get/@Post
│   ├── agents/
│   │   └── assistant.agent.ts    # AI agent com @Agent/@MainLoop
│   ├── toolboxes/
│   │   └── task.tools.ts         # Tools do agent com @Tool
│   ├── guards/
│   │   └── auth.guard.ts         # RBAC com @Roles
│   ├── interceptors/
│   │   └── timing.interceptor.ts # X-Response-Time header
│   ├── filters/
│   │   └── http-error.filter.ts  # JSON error formatting
│   ├── middleware/
│   │   └── logger.middleware.ts  # Request logging
│   ├── store.ts                  # In-memory data (4 tasks seed)
│   └── index.ts                  # Barrel — registration point
├── app.ts                        # Entry point
├── theo.config.ts                # Config (quando necessario)
└── .env.example                  # Template de env vars
```

**Checklist Fase 1:**
- [ ] Diretorio criado sem erros
- [ ] `package.json` tem deps: `@theokit/http`, `@theokit/agents`, `reflect-metadata`, `zod`
- [ ] `server/index.ts` exporta `TasksController`, `AssistantAgent`, `TaskTools`

---

## Fase 2 — Instalar e rodar (3 min)

```bash
pnpm install    # ou npm install
pnpm dev        # inicia em http://localhost:3000
```

O terminal deve mostrar:

```
[TheoApp] Registered controller: TasksController → /api/tasks (6 routes)
[TheoApp] Registered agent: AssistantAgent → /api/agents/assistant
[TheoApp] Server listening on http://localhost:3000
```

**Checklist Fase 2:**
- [ ] `pnpm install` sem erros
- [ ] `pnpm dev` inicia sem crash
- [ ] Terminal mostra controller + agent registrados

---

## Fase 3 — Testar HTTP CRUD (5 min)

Abra outro terminal. Todos os endpoints abaixo devem funcionar:

### 3.1 — Listar tasks (publico, sem auth)

```bash
curl http://localhost:3000/api/tasks
```

Esperado: array JSON com 4 tasks seed.

```json
[
  {"id":1,"title":"Set up TheoKit project","priority":"high","done":true,"createdAt":"2026-01-01"},
  {"id":2,"title":"Create first controller","priority":"high","done":true,"createdAt":"2026-01-02"},
  {"id":3,"title":"Add AI agent","priority":"medium","done":false,"createdAt":"2026-01-03"},
  {"id":4,"title":"Deploy to production","priority":"low","done":false,"createdAt":"2026-01-04"}
]
```

### 3.2 — Buscar tasks

```bash
curl "http://localhost:3000/api/tasks/search?q=agent"
```

Esperado: array com 1 task ("Add AI agent").

### 3.3 — Buscar por ID

```bash
curl http://localhost:3000/api/tasks/1
```

Esperado: objeto da task 1.

### 3.4 — Criar task (requer auth)

```bash
# Sem header x-role → 403 Forbidden
curl -X POST http://localhost:3000/api/tasks \
  -H "Content-Type: application/json" \
  -d '{"title":"Nova task do dogfood","priority":"high"}'

# Com header x-role → 201 Created
curl -X POST http://localhost:3000/api/tasks \
  -H "Content-Type: application/json" \
  -H "x-role: user" \
  -d '{"title":"Nova task do dogfood","priority":"high"}'
```

Esperado: 403 sem role, JSON com id/title com role.

### 3.5 — Validacao Zod

```bash
curl -X POST http://localhost:3000/api/tasks \
  -H "Content-Type: application/json" \
  -H "x-role: user" \
  -d '{"title":"ab"}'
```

Esperado: 400 com mensagem "Title must be at least 3 characters".

### 3.6 — Task nao encontrada

```bash
curl http://localhost:3000/api/tasks/999
```

Esperado: 404 com `{"error":"Task 999 not found"}`.

### 3.7 — Deletar task (requer admin)

```bash
# User nao pode deletar
curl -X DELETE http://localhost:3000/api/tasks/1 -H "x-role: user"

# Admin pode deletar
curl -X DELETE http://localhost:3000/api/tasks/1 -H "x-role: admin"
```

Esperado: 403 para user, 204 para admin.

### 3.8 — Verificar interceptor

```bash
curl -v http://localhost:3000/api/tasks 2>&1 | grep -i x-response-time
```

Esperado: header `X-Response-Time: Xms` presente.

**Checklist Fase 3:**
- [ ] GET /api/tasks retorna 4 tasks
- [ ] GET /api/tasks/search?q=agent retorna 1 task
- [ ] GET /api/tasks/999 retorna 404
- [ ] POST sem x-role retorna 403
- [ ] POST com x-role: user retorna task criada
- [ ] POST com body invalido retorna 400 + mensagem Zod
- [ ] DELETE com x-role: user retorna 403
- [ ] DELETE com x-role: admin retorna 204
- [ ] Header X-Response-Time presente

---

## Fase 4 — Testar AI Agent com LLM real (5 min)

### 4.1 — Configurar API key

```bash
cp .env.example .env
# Edite .env com sua key:
# OPENROUTER_API_KEY=sk-or-v1-...
```

Reinicie o dev server (`Ctrl+C` + `pnpm dev`).

### 4.2 — Chat com o agent (SSE streaming)

```bash
curl -N -X POST http://localhost:3000/api/agents/assistant/chat \
  -H "Content-Type: application/json" \
  -H "x-role: user" \
  -d '{"message":"List all tasks and tell me which ones are not done yet"}'
```

Esperado: stream SSE com eventos:

```
data: {"type":"run_started","runId":"...","agentName":"assistant"}

data: {"type":"text_delta","content":"Let me check"}

data: {"type":"tool_call","callId":"...","toolName":"task.list","input":{}}

data: {"type":"tool_result","callId":"...","toolName":"task.list","output":"[...]"}

data: {"type":"text_delta","content":"You have 2 tasks not done..."}

data: {"type":"done","result":"...","usage":{"totalTokens":...},"cost":0.001}
```

### 4.3 — Agent cria task via tool

```bash
curl -N -X POST http://localhost:3000/api/agents/assistant/chat \
  -H "Content-Type: application/json" \
  -H "x-role: user" \
  -d '{"message":"Create a task called Review PR with high priority"}'
```

Esperado: agent chama tool `task.create`, task aparece no GET /api/tasks.

### 4.4 — Verificar que a task foi criada

```bash
curl http://localhost:3000/api/tasks
```

Esperado: array com 5+ tasks (4 seed + as criadas pelo agent).

### 4.5 — Agent sem auth

```bash
curl -N -X POST http://localhost:3000/api/agents/assistant/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"hello"}'
```

Esperado: 403 Forbidden (mesmo guard do controller).

**Checklist Fase 4:**
- [ ] Agent responde via SSE stream
- [ ] Eventos tem tipos corretos (run_started, text_delta, tool_call, tool_result, done)
- [ ] Agent consegue listar tasks via tool
- [ ] Agent consegue criar task via tool
- [ ] Task criada pelo agent aparece no GET /api/tasks
- [ ] Agent sem x-role retorna 403

---

## Fase 5 — Build e producao (2 min)

```bash
pnpm build
pnpm start
```

Repita os testes da Fase 3 (CRUD) contra o server de producao. Deve funcionar identicamente.

**Checklist Fase 5:**
- [ ] `pnpm build` gera `dist/app.js` sem erros
- [ ] `pnpm start` inicia o server
- [ ] CRUD funciona em modo producao

---

## Fase 6 — Convention naming (verificacao)

Abra os arquivos e confirme que a convencao funciona:

| Arquivo | Decorator | Rota inferida |
|---|---|---|
| `server/controllers/tasks.controller.ts` | `@Controller()` | `/api/tasks` |
| `server/agents/assistant.agent.ts` | `@Agent()` | `/api/agents/assistant` |
| `server/toolboxes/task.tools.ts` | `@Toolbox()` | namespace: `task` |

Nenhum desses decorators tem argumentos de rota — tudo e inferido do nome da classe.

**Checklist Fase 6:**
- [ ] Controller sem argumento de prefix funciona
- [ ] Agent sem argumento de route funciona
- [ ] Toolbox sem argumento de namespace funciona

---

## Fase 7 — Criar segundo controller (extensibilidade)

Teste se o time consegue adicionar um novo controller sem tocar em config:

```bash
# Criar arquivo
cat > server/controllers/notes.controller.ts << 'EOF'
import 'reflect-metadata'
import { Controller, Get, Post, Body } from '@theokit/http'
import { z } from 'zod'

const notes: { id: number; text: string }[] = []
let seq = 0

@Controller()
export class NotesController {
  @Get()
  list() { return notes }

  @Post()
  create(@Body(z.object({ text: z.string().min(1) })) body: { text: string }) {
    const note = { id: ++seq, text: body.text }
    notes.push(note)
    return note
  }
}
EOF
```

Registre no barrel:

```typescript
// server/index.ts — adicione:
export { NotesController } from './controllers/notes.controller.js'
```

E no app.ts, adicione ao array `controllers`:

```typescript
import { TasksController, AssistantAgent, TaskTools, NotesController } from './server/index.js'

controllers: [TasksController, NotesController],
```

Reinicie `pnpm dev` e teste:

```bash
curl http://localhost:3000/api/notes
# → []

curl -X POST http://localhost:3000/api/notes \
  -H "Content-Type: application/json" \
  -d '{"text":"Minha primeira nota"}'
# → {"id":1,"text":"Minha primeira nota"}
```

**Checklist Fase 7:**
- [ ] Novo controller funciona sem config adicional
- [ ] Rota inferida corretamente (/api/notes)
- [ ] Zod validation funciona no novo controller

---

## Resultado do Dogfood

### Formulario de resultado

Preencha apos completar todas as fases:

| Fase | Status | Tempo | Problemas encontrados |
|---|---|---|---|
| 1. Scaffold | PASS / FAIL | __min | |
| 2. Install + Dev | PASS / FAIL | __min | |
| 3. HTTP CRUD (9 checks) | __/9 | __min | |
| 4. AI Agent (6 checks) | __/6 | __min | |
| 5. Build + Prod | PASS / FAIL | __min | |
| 6. Convention naming | __/3 | __min | |
| 7. Extensibilidade | __/3 | __min | |

### Informacoes do ambiente

```
Node: (node -v)
OS: (uname -a ou Windows version)
Package manager: pnpm / npm / yarn / bun
API key provider: OpenRouter / Anthropic / OpenAI
```

### Bugs encontrados

Descreva qualquer bug com:
1. Fase onde ocorreu
2. Comando exato que falhou
3. Output do erro (copie do terminal)
4. Comportamento esperado vs real

### Feedback qualitativo

1. O scaffold foi intuitivo? (1-5)
2. A convencao de nomes fez sentido sem ler docs? (1-5)
3. O modelo de guards compartilhados (HTTP + AI) e claro? (1-5)
4. Quanto tempo levou do zero ate o primeiro request funcional? (__min)
5. O que voce mudaria primeiro?

---

## Troubleshooting

### `pnpm dev` crash com "emitDecoratorMetadata"
A template usa `@swc/core` para compilar decorators. Se o install falhou parcialmente:
```bash
pnpm rebuild @swc/core
```

### Agent retorna erro "No API key provided"
Verifique que `.env` tem a key sem aspas:
```
OPENROUTER_API_KEY=sk-or-v1-abc123
```
E reinicie o dev server.

### 403 em todos os endpoints
O `RolesGuard` verifica o header `x-role`. Endpoints marcados `@IsPublic(true)` (GET list/search/findById) nao precisam. POST/PUT/DELETE precisam de `x-role: user` ou `x-role: admin`.

### Agent nao chama tools
O LLM precisa "decidir" chamar o tool. Tente ser explicito: "Use the list tool to show me all tasks" em vez de "show tasks".

### Build falha com type errors
```bash
pnpm typecheck   # mostra os erros
```
