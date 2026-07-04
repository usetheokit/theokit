@AGENTS.md

## Claude Code Extensions

This project includes TheoKit-aware skills that activate automatically when you edit relevant files.

### Available Skills

| Skill | Triggers when editing | What it provides |
|-------|----------------------|------------------|
| theokit-routes | `server/routes/**` | defineRoute API, Zod validation, HTTP methods, dynamic params |
| theokit-agents | `**/*agent*`, `**/*tool*`, `**/*Agent*`, `**/*Tool*` | @Agent, @Tool, @Toolbox decorators, LLM integration |
| theokit-database | `**/*schema*`, `**/*db*`, `**/drizzle*`, `**/*migration*`, `**/*seed*` | Drizzle ORM, SQLite, schema patterns, migrations |
| theokit-frontend | `app/**` | File-based routing, layouts, theoFetch, useAgent |
| theokit-ui | `app/**`, `**/*Chat*`, `**/*Sidebar*`, `**/*Theme*` | @theokit/ui AI components: ChatThread, ChatMessage, ToolCallCard, theming (generic primitives like CodeBlock/Sidebar come from @usetheo/ui) |
| theokit-config | `theo.config*`, `**/*config*` | defineConfig options, plugins, security, storage |

### Settings

See `.claude/settings.json` for safe-default permissions.

### Customization

Add project-specific context below this line (team conventions, business domain, external APIs):

<!-- YOUR PROJECT CONTEXT HERE -->
