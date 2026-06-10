# Dogfood Test Plan — TheoKit Full-Stack Validation

## Objetivo

Validar que um dev externo consegue criar, rodar e usar uma aplicação TheoKit completa **do zero**, usando apenas pacotes publicados no npm. Nenhum workspace link, nenhum relative path, nenhum acesso ao monorepo.

## Aplicação: **HelpDesk AI** — Sistema de tickets com agente de suporte

Uma aplicação REAL que empresas usariam: sistema de tickets de suporte onde um AI agent responde perguntas, escala tickets, e sugere soluções baseado no histórico.

---

## Passo a Passo (Executar em diretório LIMPO)

### Fase 0 — Setup do ambiente

```bash
# Requisitos
node --version   # >= 22
bun --version    # >= 1.3 (ou usar npx tsx)

# Criar diretório FORA do monorepo
cd /tmp
mkdir helpdesk-ai && cd helpdesk-ai
```

### Fase 1 — Scaffold com create-theokit

```bash
# TESTE 1: npx create-theokit funciona
npx create-theokit .

# Verificar:
# [ ] Comando executa sem erro
# [ ] Arquivos gerados: app.ts, server/, app/, tsconfig.json, package.json
# [ ] package.json contém: theokit, @theokit/http-decorators, @theokit/agents
```

### Fase 2 — Instalação de dependências

```bash
npm install

# Verificar:
# [ ] npm install exit 0
# [ ] node_modules/@theokit/http-decorators existe
# [ ] node_modules/@theokit/agents existe
# [ ] reflect-metadata e zod instalados
```

### Fase 3 — Rodar o template default

```bash
# Configurar LLM
echo 'OPENROUTER_API_KEY=sk-or-v1-YOUR_KEY_HERE' > .env
source .env && export OPENROUTER_API_KEY

# Rodar
bun app.ts
# ou: npx tsx app.ts

# Verificar:
# [ ] Server inicia sem erro
# [ ] Console mostra: "TheoKit app listening on http://localhost:3000"
# [ ] Console mostra: Agent "assistant" mounted at /api/agents/assistant/chat (N tools)
```

### Fase 4 — Testar HTTP Controllers (CRUD)

```bash
# TESTE 2: GET público (sem auth)
curl http://localhost:3000/api/tasks
# [ ] Status 200
# [ ] Retorna array JSON com tasks

# TESTE 3: POST com auth
curl -X POST http://localhost:3000/api/tasks \
  -H "Content-Type: application/json" -H "x-role: user" \
  -d '{"title":"Test from dogfood","priority":"high"}'
# [ ] Status 201
# [ ] Retorna task criada com id

# TESTE 4: POST sem auth → 403
curl -X POST http://localhost:3000/api/tasks \
  -H "Content-Type: application/json" \
  -d '{"title":"Should fail"}'
# [ ] Status 403
# [ ] JSON com error.code = "FORBIDDEN"

# TESTE 5: POST com body inválido → 422
curl -X POST http://localhost:3000/api/tasks \
  -H "Content-Type: application/json" -H "x-role: user" \
  -d '{"title":"ab"}'
# [ ] Status 422
# [ ] JSON com error.code = "VALIDATION_ERROR"

# TESTE 6: GET 404
curl http://localhost:3000/api/tasks/999
# [ ] Status 404
# [ ] JSON com error.message contendo "not found"

# TESTE 7: DELETE requer Admin
curl -X DELETE http://localhost:3000/api/tasks/1 -H "x-role: user"
# [ ] Status 403 (user não pode deletar, precisa admin)

curl -X DELETE http://localhost:3000/api/tasks/1 -H "x-role: admin"
# [ ] Status 204
```

### Fase 5 — Testar AI Agent (LLM real)

```bash
# TESTE 8: Agent sem auth → 403
curl -X POST http://localhost:3000/api/agents/assistant/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"hello"}'
# [ ] Status 403

# TESTE 9: Agent com auth → SSE stream
curl -N -X POST http://localhost:3000/api/agents/assistant/chat \
  -H "Content-Type: application/json" -H "x-role: user" \
  -d '{"message":"List all tasks"}'
# [ ] Status 200
# [ ] Content-Type: text/event-stream
# [ ] Evento run_started com agentName
# [ ] Evento tool_call (LLM decide chamar tasks.list)
# [ ] Evento tool_result (resultado real do store)
# [ ] Eventos text_delta (token por token)
# [ ] Evento done com usage (tokens, cost, duration)

# TESTE 10: Agent tool calling → cria task
curl -N -X POST http://localhost:3000/api/agents/assistant/chat \
  -H "Content-Type: application/json" -H "x-role: user" \
  -d '{"message":"Create a task called Deploy to AWS with high priority"}'
# [ ] LLM chama tool tasks.create
# [ ] Task criada no store
# [ ] Resposta confirma criação

# TESTE 11: Multi-turn (mesma sessão)
curl -N -X POST http://localhost:3000/api/agents/assistant/chat \
  -H "Content-Type: application/json" -H "x-role: user" \
  -d '{"message":"List all tasks","sessionId":"test-session"}'
# (esperar resposta)

curl -N -X POST http://localhost:3000/api/agents/assistant/chat \
  -H "Content-Type: application/json" -H "x-role: user" \
  -d '{"message":"Mark the first one as done","sessionId":"test-session"}'
# [ ] Agent lembra do contexto anterior
# [ ] Chama tool tasks.complete com o ID correto
```

### Fase 6 — Testar Frontend (Browser)

```bash
# Abrir http://localhost:3000 no browser

# TESTE 12: Página carrega
# [ ] Task table visível com dados
# [ ] Chat box visível
# [ ] Role selector funciona

# TESTE 13: CRUD via UI
# [ ] Criar task pelo form → aparece na tabela
# [ ] Mudar role para "None" → criar task falha com erro 403 visível

# TESTE 14: Chat via UI
# [ ] Digitar mensagem → typing animation (token por token)
# [ ] Tool calls visíveis na UI (🔧 Calling: tasks.list)
# [ ] Tool results visíveis (✅ resultado)
# [ ] Cost/tokens exibidos após resposta
# [ ] Segunda mensagem mantém contexto (multi-turn)
```

### Fase 7 — Customizar a aplicação (Dev Experience)

```bash
# TESTE 15: Adicionar novo controller
# Criar server/controllers/users.controller.ts com @Controller('api/users')
# Adicionar ao app.ts: controllers: [TasksController, UsersController]
# [ ] Novo endpoint /api/users funciona

# TESTE 16: Adicionar nova tool ao agent
# Editar server/toolboxes/task.tools.ts
# Adicionar @Tool({ name: 'stats', description: 'Get task stats', input: z.object({}) })
# [ ] Agent consegue chamar a nova tool
# [ ] Manifest mostra nova tool

# TESTE 17: Criar custom decorator
# Em server/guards/auth.guard.ts, criar:
#   const IsInternal = createDecorator<boolean>()
# Aplicar a uma rota
# [ ] Decorator funciona com Reflector.getAllAndOverride

# TESTE 18: Adicionar interceptor
# Criar server/interceptors/logging.interceptor.ts
# Aplicar via @UseInterceptors no controller E no agent
# [ ] Interceptor executa em ambos (shared pipeline)
```

### Fase 8 — Validação de Runtimes

```bash
# TESTE 19: Bun
bun app.ts
# [ ] Server inicia e responde

# TESTE 20: Node
npx tsx app.ts
# [ ] Server inicia e responde

# TESTE 21: Deno (se instalado)
deno run -A --unstable-sloppy-imports app.ts
# [ ] Server inicia e responde
```

---

## Checklist Final

### Funcional

| # | Teste | Pass? |
|---|---|---|
| 1 | npx create-theokit gera projeto | |
| 2 | npm install resolve todos os pacotes | |
| 3 | Server inicia sem erro | |
| 4 | GET público retorna dados | |
| 5 | POST com auth cria recurso | |
| 6 | POST sem auth retorna 403 | |
| 7 | POST com body inválido retorna 422 | |
| 8 | GET recurso inexistente retorna 404 | |
| 9 | DELETE requer role Admin | |
| 10 | Agent sem auth retorna 403 | |
| 11 | Agent retorna SSE stream com events | |
| 12 | Agent chama tools reais | |
| 13 | Agent cria/modifica dados via tools | |
| 14 | Multi-turn mantém contexto | |
| 15 | Frontend carrega e mostra dados | |
| 16 | Frontend CRUD funciona | |
| 17 | Frontend chat mostra typing animation | |
| 18 | Frontend mostra tool calls | |
| 19 | Frontend mostra cost/tokens | |

### Dev Experience

| # | Teste | Pass? |
|---|---|---|
| 20 | Adicionar controller funciona | |
| 21 | Adicionar tool funciona | |
| 22 | Custom decorator funciona | |
| 23 | Interceptor shared (controller + agent) funciona | |
| 24 | Bun funciona | |
| 25 | Node funciona | |

### Erros esperados (negativos)

| # | Teste | Pass? |
|---|---|---|
| 26 | Sem OPENROUTER_API_KEY → mensagem clara | |
| 27 | Sem @theokit/agents instalado + agents[] → mensagem clara | |
| 28 | @Body com schema inválido → 422 com issues[] | |
| 29 | Rota inexistente → 404 com mensagem | |

---

## Bugs encontrados durante o dogfood

| # | Bug | Severidade | Arquivo | Status |
|---|---|---|---|---|
| | | | | |
| | | | | |
| | | | | |

_Preencher durante a execução do teste._

---

## Como reportar

Para cada bug encontrado:
1. **Reprodução**: comando exato que falhou
2. **Esperado**: o que deveria acontecer
3. **Actual**: o que aconteceu (incluir error message completo)
4. **Ambiente**: runtime (Node/Bun/Deno), OS, versão do pacote

## Critério de aprovação

**PASS** quando todos os 25 testes funcionais passam E zero bugs com severidade ALTA.
**FAIL** quando qualquer teste de install/start/CRUD/agent falha.
