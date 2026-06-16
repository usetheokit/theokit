---
name: plan-help
version: 0.1.0
requires: []
description: Show all available Cycle ecosystem commands with descriptions and recommended flows. Use when the user asks for help, wants to know what commands are available, or says "what can you do" / "help" / "list commands".
user-invocable: true
---

# /plan-help

Display all available commands in the Cycle ecosystem, organized by workflow.

## Instructions

When invoked, read the skills/ directory to discover all available skills and
present them organized by cycle. Include the recommended flows.

### Output Format

Print the following guide:

---

## Cycle Ecosystem — Available Commands

### Recommended Flows

**A. Clear feature to build (most common):**
```
/to-plan "{description}" → /edge-case-plan → /deps-audit → /plan-confidence → /implement → /code-quality → /review → /release
```

**B. Vague requirements — need grilling first:**
```
/grill-me {topic} → then flow A
```

**C. Unknown prior art — need research first:**
```
/discover-plan {topic} → /discover-edge-cases → /discover-plan-confidence → /discover-execute → /discover-confidence → then flow A
```

**D. Full autonomous (large topics):**
```
/auto-plan {topic}
```

### Planning Cycle

| Command | Purpose |
|---|---|
| `/grill-me {topic}` | Interview to clarify requirements |
| `/to-plan "{description}"` | Create implementation plan |
| `/edge-case-plan {slug}` | Identify edge cases in plan |
| `/deps-audit {slug}` | Audit dependencies for CVEs |
| `/plan-confidence {slug}` | Score plan quality (must pass) |
| `/plan-improve {slug}` | Auto-improve plan score |

### Discovery Cycle

| Command | Purpose |
|---|---|
| `/discover-plan {topic}` | Create discovery research plan |
| `/discover-edge-cases {slug}` | Edge cases for discovery |
| `/discover-plan-confidence {slug}` | Score discovery plan |
| `/discover-execute {slug}` | Execute discovery (halt-loop) |
| `/discover-confidence {slug}` | Score blueprint quality |
| `/discover-improve {slug}` | Auto-improve blueprint |

### Implementation & Quality

| Command | Purpose |
|---|---|
| `/implement {slug}` | TDD halt-loop implementation |
| `/code-quality {slug}` | Dead code + fabricated symbol audit |
| `/review {slug}` | Multi-agent parallel review |
| `/release` | Cut semver release (develop to main) |

### Roadmap

| Command | Purpose |
|---|---|
| `/roadmap-init` | Bootstrap ROADMAP.md from scratch |
| `/roadmap-feature` | Add milestone to existing roadmap |
| `/auto-plan {topic/M<N>}` | Autonomous end-to-end pipeline |

### Utilities

| Command | Purpose |
|---|---|
| `/ast-grep` | Structural code search (tree-sitter) |
| `/deck` | Full presentation with diagrams |
| `/marp-slide` | Marp slides only |
| `/excalidraw` | Excalidraw diagram JSON |
| `/dogfood audit` | Honesty gate for v1.0 claims |
| `/plan-help` | This help (you are here) |

### Prerequisites

```bash
python3 --version              # 3.10+ required
python3 -c "import yaml"       # PyYAML
ast-grep --version             # structural queries (optional)
```
