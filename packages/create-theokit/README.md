# `create-theokit`

Scaffold a [TheoKit](https://github.com/usetheokit/theokit) app — a working agent chat, wired end to
end.

```bash
npx create-theokit my-app
cd my-app
pnpm dev
```

Node `>= 22.12.0` is required; the CLI checks before it writes anything.

## What you get

The default scaffold is not a placeholder. The thread streams real replies, the example tools run
(weather over HTTP, local time with no network), and the approval prompt really gates the
side-effecting one.

```
my-app/
├── agents/chat.ts          # the agent → POST /api/agents/chat
│   ├── prompts/            #   persona
│   ├── tools/              #   capabilities
│   └── skills/             #   procedures loaded on demand
├── app/                    # file-based routing (page/layout/loading/error/not-found)
├── server/routes/          # API routes
├── shared/agent.ts         # branding — one source of truth
├── docs/                   # ARCHITECTURE · CUSTOMIZATION · ENVIRONMENT
└── theo.config.ts
```

Point it at a provider before the first run — `OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY`, or
`OPENAI_API_KEY` in `.env` (start from `.env.example`).

## Surfaces

The same agent, three frontends — only the transport differs:

```bash
npx create-theokit my-app                      # web (default) — HTTP transport
npx create-theokit my-app --surface=tui        # terminal (Ink) — in-process transport
npx create-theokit my-app --surface=desktop    # desktop (Tauri) — channel transport
```

## Options

| Flag | Effect |
|---|---|
| `--yes` | Take the recommended defaults, skip the prompts |
| `--template=<name>` | Template to use (default `default`) |
| `--surface=<web\|tui\|desktop>` | App surface (default `web`) |
| `--bare` | Minimal app: no agent, no `@theokit/*` runtime deps, a plain Hello Theo page |
| `--skip-install` | Write the files, skip the install |
| `--disable-git` | Skip `git init` |
| `--use-npm` / `--use-pnpm` / `--use-yarn` / `--use-bun` | Pick the package manager |
| `--import-alias=<alias>` | Import alias (default `@/*`) |
| `--example=<name\|github-url>` | Bootstrap from a GitHub example |
| `--biome` | Use Biome instead of ESLint |
| `--agents-md` | Include `AGENTS.md` (default: true) |

`--bare` cannot be combined with a non-web surface — a TUI or desktop shell needs the agent
dependencies `--bare` removes, so the CLI refuses the contradiction instead of scaffolding something
that cannot run.

## Licence

Apache-2.0 — see `LICENSE`.
