# Design spike — `@theokit/agents` orientado a objetos por **capabilities componíveis**

> Exploração (não implementado). Substitui os 24 class-decorators por um modelo OO onde **cada pattern
> ganha o lugar** por uma variação real. O payoff: as MESMAS capabilities servem o framework web e o
> Agent Builder (terminal), porque ambas desembocam num `AgentSpec` canônico — o espelho do
> `AgentOutputEvent` do M49 (uma cintura estreita, N fontes).

## O núcleo: `AgentSpec` (cintura estreita) + `Capability` (Strategy/Decorator de valor)

```ts
/**
 * O rascunho mutável que uma Capability enriquece. É o ÚNICO ponto de acoplamento entre
 * autoria (fluent / preset / arquivo de config / decorator) e o runtime (SDK).
 */
export interface AgentSpecDraft {
  model?: string
  system?: string
  tools: CustomTool[]
  skills: string[]
  mcpServers: Record<string, McpServerConfig>
  hooks: HookSpec[]
  plugins: Plugin[]
  sandbox?: SandboxMode
  approval?: ApprovalPolicy
  /** Diagnóstico: quem contribuiu com o quê (resolve a opacidade que o @Expose tentou remendar). */
  readonly provenance: { capability: string; contributed: string[] }[]
}

/**
 * **Pattern: Strategy + Decorator (nível de valor).**
 * Justificativa da variação: existem N formas independentes de enriquecer um agente (sandbox, skills,
 * HITL, memória, MCP…), adicionadas/removidas sem tocar no builder. Um `switch` central violaria OCP.
 *
 * Contrato deliberadamente mínimo: `name` (identidade p/ conflito + provenance) e `apply`.
 */
export interface Capability {
  readonly name: string
  apply(draft: AgentSpecDraft): void
}
```

## Capabilities concretas (SRP: uma classe, uma razão para mudar)

```ts
/** Confina a execução. Classe (não função) porque VALIDA e detecta conflito — tem comportamento. */
export class SandboxCapability implements Capability {
  readonly name = 'sandbox'
  constructor(private readonly mode: SandboxMode) {
    if (!SANDBOX_MODES.includes(mode)) {
      throw new ConfigurationError(`sandbox: modo inválido "${mode}" — use ${SANDBOX_MODES.join(' | ')}`)
    }
  }
  apply(draft: AgentSpecDraft): void {
    if (draft.sandbox !== undefined && draft.sandbox !== this.mode) {
      // Fail-fast (Rule 8): dois sandboxes conflitantes é bug de composição, não "último vence".
      throw new ConfigurationError(`sandbox declarado duas vezes: "${draft.sandbox}" vs "${this.mode}"`)
    }
    draft.sandbox = this.mode
    draft.provenance.push({ capability: this.name, contributed: ['sandbox'] })
  }
}

/** Aprovação humana antes de tools que casam o predicado. */
export class HumanInTheLoopCapability implements Capability {
  readonly name = 'human-in-the-loop'
  constructor(private readonly opts: { on: (tool: string) => boolean; policy?: ApprovalPolicy }) {}
  apply(draft: AgentSpecDraft): void {
    draft.approval = this.opts.policy ?? 'on-request'
    draft.hooks.push({ event: 'pre_tool_call', gate: this.opts.on })
    draft.provenance.push({ capability: this.name, contributed: ['approval', 'hooks'] })
  }
}

/** Skills por nome — capability SEM comportamento; aqui uma função bastaria (ver "onde NÃO usar classe"). */
export const skills = (names: readonly string[]): Capability => ({
  name: 'skills',
  apply: (d) => {
    d.skills.push(...names)
    d.provenance.push({ capability: 'skills', contributed: ['skills'] })
  },
})
```

## **Composite** — presets que se comportam como UMA capability

```ts
/**
 * **Pattern: Composite.** Justificativa: um preset ("agente de código") é um conjunto de capabilities
 * que o chamador quer tratar como UMA. Sem Composite, o preset seria um array espalhado no call-site.
 */
export class CapabilityPreset implements Capability {
  constructor(readonly name: string, private readonly members: readonly Capability[]) {}
  apply(draft: AgentSpecDraft): void {
    for (const c of this.members) c.apply(draft) // ordem = ordem de declaração (determinística)
  }
}

export const codingAgent = (): Capability =>
  new CapabilityPreset('preset:coding', [
    new SandboxCapability('workspace-write'),
    skills(['code-review', 'testing']),
    new HumanInTheLoopCapability({ on: (t) => t === 'write_file' || t === 'shell' }),
  ])
```

## **Chain of Responsibility** — interceptação de tools

```ts
/**
 * **Pattern: Chain of Responsibility.** Justificativa: N interceptadores independentes (guardrail,
 * auditoria, rate-limit) precisam poder VETAR ou transformar a chamada, sem se conhecerem.
 * (É o mesmo shape que o `.hooks()` já expõe — aqui só tipado como cadeia.)
 */
export interface ToolInterceptor {
  intercept(call: ToolCall, next: (c: ToolCall) => Promise<ToolResult>): Promise<ToolResult>
}

export class InterceptorChain {
  constructor(private readonly links: readonly ToolInterceptor[]) {}
  run(call: ToolCall, terminal: (c: ToolCall) => Promise<ToolResult>): Promise<ToolResult> {
    const dispatch = (i: number, c: ToolCall): Promise<ToolResult> =>
      i === this.links.length ? terminal(c) : this.links[i].intercept(c, (n) => dispatch(i + 1, n))
    return dispatch(0, call)
  }
}
```

## **Registry** — autoria por arquivo de config (o que destrava o Agent Builder)

```ts
/**
 * **Pattern: Registry.** Justificativa (OCP): o Agent Builder declara capabilities num arquivo
 * (`.theokit/config`), então precisa resolver NOME → Capability sem um switch que cresce por feature.
 */
export class CapabilityRegistry {
  readonly #factories = new Map<string, (arg: unknown) => Capability>()
  register(name: string, factory: (arg: unknown) => Capability): this {
    this.#factories.set(name, factory)
    return this
  }
  resolve(name: string, arg: unknown): Capability {
    const f = this.#factories.get(name)
    if (f === undefined) throw new UnknownCapabilityError(name, [...this.#factories.keys()])
    return f(arg)
  }
}

export const defaultRegistry = new CapabilityRegistry()
  .register('sandbox', (m) => new SandboxCapability(m as SandboxMode))
  .register('skills', (n) => skills(n as string[]))
  .register('human-in-the-loop', (o) => new HumanInTheLoopCapability(o as never))
```

## **Adapter** — o spec canônico vira opções do SDK (a fronteira compartilhada)

```ts
/**
 * **Pattern: Adapter.** Justificativa: `AgentSpec` é a linguagem do FRAMEWORK; `Agent.create` é a do
 * RUNTIME. Um adapter isola a tradução — e é EXATAMENTE o pedaço hoje duplicado entre
 * `@theokit/agents` (agent-compiler) e o Agent Builder (buildChatAgent).
 */
export class SdkAgentAdapter {
  constructor(private readonly sandboxFactory: (m: SandboxMode) => SandboxBackend) {}
  toCreateOptions(spec: AgentSpecDraft, apiKey: string): AgentOptions {
    if (spec.model === undefined) throw new ConfigurationError('agent: `model` é obrigatório')
    return {
      apiKey,
      model: { id: spec.model },
      ...(spec.system !== undefined ? { systemPrompt: spec.system } : {}),
      tools: spec.tools,
      skills: { enabled: spec.skills },
      mcpServers: spec.mcpServers,
      plugins: spec.plugins,
      local: { cwd: process.cwd() },
      ...(spec.sandbox !== undefined ? { sandbox: this.sandboxFactory(spec.sandbox) } : {}),
    }
  }
}
```

## **Builder + Facade** — a autoria fluente (mantém os tipos acumulados que já existem)

```ts
/**
 * **Pattern: Builder (imutável) + Facade.** Justificativa: acumular parâmetros de tipo (o `.tool()`
 * que dá erro quando o run-context ⊄ o do agente) e exigir `.model()` antes do `.build()` — algo que
 * decorator não consegue expressar. `.use()` é o ÚNICO ponto de extensão: OCP.
 */
class AgentDefinitionBuilder {
  private constructor(private readonly caps: readonly Capability[]) {}
  static create(): AgentDefinitionBuilder { return new AgentDefinitionBuilder([]) }
  use(capability: Capability): AgentDefinitionBuilder {
    return new AgentDefinitionBuilder([...this.caps, capability]) // imutável: cada passo é um valor novo
  }
  build(): AgentSpecDraft {
    const draft: AgentSpecDraft = { tools: [], skills: [], mcpServers: {}, hooks: [], plugins: [], provenance: [] }
    for (const c of this.caps) c.apply(draft)
    return draft
  }
}

export const agent = (): AgentDefinitionBuilder => AgentDefinitionBuilder.create() // Facade
```

## As três autorias convergem no MESMO spec

```ts
// 1) fluente (web ou terminal)
const a = agent().use(model('openai/gpt-5.4')).use(codingAgent()).use(tool(shell)).build()

// 2) preset (Composite) — uma linha
const b = agent().use(model('openai/gpt-5.4')).use(codingAgent()).build()

// 3) arquivo de config (Agent Builder) — Registry resolve nome → Capability
const fromFile = cfg.capabilities.reduce(
  (bld, { name, arg }) => bld.use(defaultRegistry.resolve(name, arg)),
  agent().use(model(cfg.model)),
).build()

// e o Adapter fecha, igual para os três:
const sdkAgent = await Agent.create(new SdkAgentAdapter(createSandboxBackend).toCreateOptions(a, key))
```

## Por que isso é melhor DX que o decorator

| | decorator de classe | capability (este desenho) |
|---|---|---|
| Build config | exige `experimentalDecorators` + `reflect-metadata` | nenhuma |
| Autoria | obriga classe | qualquer estilo (fluent, preset, arquivo) |
| Visibilidade | metadata implícita (o M47 existiu p/ remendar) | `draft.provenance` diz quem contribuiu com o quê |
| Teste | precisa instanciar a classe decorada | `cap.apply(draft)` — unitário puro |
| Composição | herança/mixin | Composite + ordem determinística |
| Conflito | silencioso (último vence) | fail-fast typed (`sandbox` duplicado) |
| Tipos | metadata não acumula tipo | builder acumula (`.tool()` valida run-context) |

## Honestidade: onde eu NÃO usei pattern (e por quê)

- **`skills` é função, não classe** — não tem estado nem validação; classe seria cerimônia (KISS).
- **Sem Abstract Factory** — há UMA família de produtos (`Capability`); factory abstrata seria indireção sem variação.
- **Sem Visitor** — o `AgentSpecDraft` é um record estável; visitor pagaria double-dispatch por nada.
- **Sem Mediator** — as capabilities não conversam entre si; o draft já é o ponto de encontro.
- **Sem Singleton** — `defaultRegistry` é um valor exportado, não um singleton com `getInstance()` (testável, substituível).
- **Sem Observer** — o streaming já é async-iterator; adicionar observer duplicaria o mecanismo.
- **Sem Template Method** — nenhuma hierarquia de algoritmo com passos fixos; Strategy resolve.

## O payoff estratégico

`AgentSpec` + `SdkAgentAdapter` são exatamente o pedaço **hoje duplicado** entre `@theokit/agents`
(`agent-compiler` + `sdk-adapter-create-options`) e o Agent Builder (`agents/chat.ts`). Unificar aqui
faz as capabilities do terminal (sandbox, trust, hooks) ficarem disponíveis ao web, e as do web
(guardrails, delegação) ao terminal — sem forçar o que é legitimamente diferente (rotas/SSE de um lado;
sessões/PTY/credenciais do outro).
