---
name: ast-grep
version: 0.1.0
requires: []
description: Structural search and refactor across multi-language codebases via tree-sitter patterns. Use when you need queries Grep can't express — function signatures, class hierarchies, decorator + function, call sites, async patterns, type definitions. Especially useful inside knowledge-base/references/ during /discover-execute. Composable from any context.
user-invocable: true
allowed-tools: Bash Read Glob
argument-hint: "{pattern} [--lang LANG] [--path PATH]"
---

# ast-grep — Structural Code Search

`ast-grep` (binary: `ast-grep` or `sg`) is a tree-sitter-based structural search/refactor tool. It matches by AST shape, not by literal text — finds "all functions that return Promise<X>" or "all classes that extend BaseClass" in a single multi-language query.

**Composable skill — this is the only SKILL.md in `.claude/skills/` that is NOT bound to a cycle.** It has no `cycle-*.md` contract, no upstream/downstream phase, no halt-loop. It is a utility consumed by other skills (notably `/discover-execute`) or invoked directly from any context (code review, refactor planning, debugging). Treat it as a thin wrapper over a CLI binary plus a curated set of YAML rules under `rules/`.

## Workflow: zoom out (ast-grep) → zoom in (Read)

`ast-grep` is **step 1 of a two-step investigation**, not a replacement for Read or Grep. The right mental model:

| Step | Tool | Question it answers |
|---|---|---|
| **1. Zoom out (map)** | `ast-grep` | **Where** does X exist? How many? What shape? Which files? Which line ranges? |
| **2. Zoom in (deep)** | `Read` | **How** does it actually work? What's the intent? What do the comments say? What are the edge cases? |

### Why this order

`ast-grep` gives you a structural inventory cheap (line ranges + AST kinds). It lists, it counts, it maps. It does NOT explain — comments, intent, error-handling, edge-cases are below its abstraction.

`Read` gives you semantic depth at one location, but is inefficient across many files. Using `Read` to "explore broadly" scatters attention. Using `Read` after `ast-grep` mapped, say, 8 hotspots is targeted.

### When to skip ast-grep entirely

Some questions are textual, not structural. Use `Grep` + `Read` directly:

- "Find the file whose name contains 'pgvector'" → Glob / Grep
- "Read the README of project Y" → `Read`
- "What's the SQL in this migration file?" → `Read`
- "Find every TODO comment" → `Grep`

For everything code-shape (class hierarchies, function signatures, call sites, decorators, control flow, type definitions), **Fase A (ast-grep) is the right starting point** before Read.

### Concrete two-step example

Discovery question: "How does Project A implement the `Memory` class surface?"

**Step 1 — ast-grep maps the surface (Fase A):**

```bash
ast-grep scan --rule .claude/skills/ast-grep/rules/method-in-class-ts.yml \
  .claude/knowledge-base/references/project-a/project-a-ts/src/oss/src/memory/index.ts
# → 27 methods, each with line range. One query, compact output.
```

Output: a hotspot list of 27 methods + their line ranges in `index.ts`.

**Step 2 — Read at each hotspot (Fase B):**

For each method on the list, `Read index.ts L153-L189` (constructor), `Read L191-L240` (add()), etc. Each Read produces a paragraph for the blueprint + a `.claude/knowledge-base/references/project-a/.../index.ts:N` citation.

Result: a blueprint section that BOTH lists the entire surface (from Fase A) AND explains each non-trivial method (from Fase B), with line-exact citations.

### Quick reference — common Fase A queries

| Question (broad) | Tool | Rule file |
|---|---|---|
| "Find ALL classes that extend X" | `ast-grep scan --rule` | `rules/class-extends-ts.yml` |
| "List the method surface of any class" | `ast-grep scan --rule` | `rules/method-in-class-ts.yml` |
| "Find call sites of `obj.method(...)`" | `ast-grep scan --rule` | `rules/method-call-ts.yml` |
| "Find Python decorator + function combos" | `ast-grep scan --rule` | `rules/decorated-function-python.yml` |
| "List every Python `async def`" | `ast-grep scan --rule` | `rules/async-function-python.yml` |
| "Compare signatures across Project A (TS) and Project B (Python)" | `ast-grep run --pattern --lang` ×2 | inline, one per language |
| "Find every `import` of a module" | `ast-grep run --pattern` or `kind: import_statement` | inline |

## Quick reference — inline patterns (`ast-grep run`)

```bash
# Single-pattern search (TS): class with extends
ast-grep run --pattern 'class $NAME extends $BASE { $$$ }' \
  --lang typescript .claude/knowledge-base/references/project-a/

# Method call by name (TS)
ast-grep run --pattern '$OBJ.embed($$$)' \
  --lang typescript .claude/knowledge-base/references/project-a/

# Python async functions
ast-grep run --pattern 'async def $NAME($$$):
    $$$' --lang python .claude/knowledge-base/references/project-c/
```

Pattern syntax:

- `$NAME` — single AST node placeholder (matches identifier, expression, etc.)
- `$$$` — zero-or-more nodes placeholder
- Literal text matches as-is

Limitations:

- Multi-statement patterns (decorator + function, etc.) often fail with `Multiple AST nodes detected`. Use a YAML rule file with `kind:` or `all:` + `inside:` instead (see Rule files below).

## Rule files — pre-built (in `rules/`)

The five YAML rule files shipped here cover the most common queries `/discover-execute` runs. Invoke with `ast-grep scan --rule <file> <path>`.

| Rule file | Language | What it finds | Example use |
|---|---|---|---|
| `rules/class-extends-ts.yml` | TypeScript | Every class that has an `extends` clause | Find error class hierarchies, inheritance chains in Project A |
| `rules/method-in-class-ts.yml` | TypeScript | Every method defined inside any class body | List the surface of a class (Project A's `Memory`) |
| `rules/method-call-ts.yml` | TypeScript | Calls to a named method (`$OBJ.METHOD($$$)`) | Find call sites of `.embed()`, `.add()`, `.search()` |
| `rules/async-function-python.yml` | Python | Every `async def` function | Map Project B's async surface, Project C's reflection loop |
| `rules/decorated-function-python.yml` | Python | Every function with a decorator (any decorator) | Find `@pytest.fixture`, `@runtime_checkable`, dataclass-style decorators in Project B |

Each rule file is a standalone YAML. You can copy + modify (e.g., constrain `$BASE` to a specific class name).

### Customizing a rule

```yaml
# rules/class-extends-ts.yml — current shape
id: class-extends-ts
language: typescript
rule:
  pattern: 'class $NAME extends $BASE { $$$ }'
```

To narrow to "classes extending `Memory` specifically", duplicate and edit:

```yaml
id: class-extends-memory
language: typescript
rule:
  all:
    - pattern: 'class $NAME extends $BASE { $$$ }'
    - has:
        regex: '\bMemory\b'
```

## How `/discover-execute` consumes this skill

During the halt-loop, the agent runs the **two-phase workflow above** for every code-shape research question: Fase A (ast-grep map) → Fase B (Read at each hotspot). The `execute-mode-prompt.md` enforces Fase A as mandatory before any Read for structural questions; only text-shape questions (README content, raw config files) skip Fase A. The Fase A output produces the hotspot table; the Fase B Reads produce the prose + `.claude/knowledge-base/references/{project}/{path}:N` citations that go into the blueprint.

## Setup

`ast-grep` is a Rust binary. Install once per machine:

```bash
# via npm (matches the convention used by other Python/Node tools in this project)
npm install -g @ast-grep/cli

# OR via Cargo
cargo install ast-grep --locked

# OR via Homebrew (macOS)
brew install ast-grep
```

Verify:

```bash
ast-grep --version    # should print >= 0.42.x
```

**Naming collision on Linux**: `/usr/bin/sg` is the `switch group` system command (shadow-utils). The ast-grep binary is also called `sg`, but `npm install -g` installs it under `~/.nvm/...` which appears earlier in PATH. Prefer the `ast-grep` long name in scripts to avoid ambiguity.

For automated checks, run `bash setup.sh` from this skill directory.

## Anti-patterns

1. **Don't use ast-grep for "find file containing word X"** — Grep is faster and clearer. ast-grep shines when the question is about AST shape.
2. **Don't write multi-statement patterns inline** — `ast-grep run -p 'pattern1\npattern2'` triggers the "Multiple AST nodes" error. Use a YAML rule file with `kind:` or relational rules (`inside:`, `has:`).
3. **Don't write rules without testing** — keep `ast-grep scan --rule <file> <small-dir>` in your loop. Rules silently match zero things when patterns drift from real AST shapes.
4. **Don't cite ast-grep output as a citation without re-verifying the line** — ast-grep gives line ranges; the blueprint cites `.claude/knowledge-base/references/path:N`. Always re-read the file at that line before committing to the citation.

## Related

- Setup script: `setup.sh`
- Portable install docs: `PORTABLE.md`
- Pre-built rules: `rules/*.yml`
- Consumer skill: `/discover-execute` (`.claude/skills/discover-execute/prompts/execute-mode-prompt.md`)
- ast-grep upstream: <https://github.com/ast-grep/ast-grep>
- Pattern syntax guide: <https://ast-grep.github.io/guide/pattern-syntax.html>
- Rule config guide: <https://ast-grep.github.io/guide/rule-config.html>
