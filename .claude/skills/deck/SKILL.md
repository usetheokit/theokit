---
name: deck
version: 0.1.0
requires: []
description: Create complete presentation decks with diagrams. Orchestrates /marp-slide and /excalidraw into a single workflow — plans structure, creates diagrams, builds slides, renders HTML + PPTX. Use when the user wants a full presentation with visuals.
user-invocable: true
allowed-tools: Read Glob Grep Bash Write Edit
argument-hint: "<topic, audience, or file>"
---

# Deck — Full Presentation Pipeline

> **INQUEBRÁVEL — 95% Confidence Gate**
>
> NÃO FAÇA NADA SE NÃO TIVER 95% DE CONFIANÇA.
> SEMPRE QUE PRECISAR DE UMA DECISÃO DO USUÁRIO, APRESENTE
> OPÇÕES PARA ELE ESCOLHER.
>
> See `/home/paulo/.claude/CLAUDE.md` § 1 (95% Confidence).

Orchestrates `/marp-slide` and `/excalidraw` into a single end-to-end workflow. One command produces a complete presentation with diagrams, slides, and rendered outputs.

**This skill does NOT duplicate the rules of `/marp-slide` or `/excalidraw`.** It reads their SKILL.md files at runtime and follows them. This file defines only the orchestration — what to do, in what order, and how the two skills connect.

**Project rules consumed:**
- `.claude/rules/public-copy.md` — voice rules apply to any deck that may surface in README/PITCH or marketing material.
- `.claude/rules/dogfood-golden-rule.md` — NEVER produce a deck claiming "production-ready" / "v1.0" / "production-grade" for the project without recorded dogfood evidence. Invoke `/dogfood` BEFORE generating any status-claim deck.

---

## When to Trigger

- User asks for a "presentation with diagrams", "complete deck", "visual presentation"
- User wants slides AND diagrams created together
- User says "create a presentation about X" and the topic clearly benefits from visual diagrams
- User explicitly invokes `/deck`

**When NOT to use:** If the user only wants slides (no diagrams) → use `/marp-slide`. If the user only wants a diagram → use `/excalidraw`.

---

## Workflow

### Phase 1: Plan

Before creating anything, understand the full scope:

1. **Read project conventions (in this priority):**
   - If `.claude/rules/public-copy.md` exists, **READ IT FIRST** — voice rules apply.
   - If `docs/presentations/PADRAO-APRESENTACOES.md` OR `materiais/apresentacoes/PADRAO-APRESENTACOES.md` exists, read it for layout/typography conventions.
   - Otherwise, infer theme/typography/colors from audience + content.
2. **Clarify with the user** (only if genuinely ambiguous):
   - Topic and scope
   - Audience level (simple / intermediate / technical)
   - Language (default: pt-BR)
   - Approximate number of slides (default: 10-16)
3. **Draft the slide outline** — list each slide with:
   - Title
   - Type: `lead` | `content` | `diagram` | `code` | `comparison`
   - For `diagram` slides: one-line description of what the diagram shows
4. **Present the outline to the user** and wait for approval before proceeding

> The outline is the contract. No diagram gets created without appearing in the outline.

### Phase 2: Diagrams (Excalidraw)

For each slide marked as `diagram` in the outline:

1. **Read the excalidraw skill** — `.claude/skills/excalidraw/SKILL.md`
2. **Read the color palette** — `.claude/skills/excalidraw/references/color-palette.md`
3. **Create the directory** — `diagrams/<deck-name>/`
4. **For each diagram**, following the excalidraw skill rules:
   - Assess depth (simple vs comprehensive) based on audience level
   - Design the visual structure (patterns, shapes, flow)
   - Generate JSON section-by-section (for large diagrams)
   - Use **1280x720 frame** (matches slide dimensions)
   - Use descriptive filenames: `01-problem.excalidraw`, `02-architecture.excalidraw`
5. **Render each diagram** to PNG using the excalidraw render script
6. **View each PNG** and fix visual defects (the render-view-fix loop)
7. **Verify all diagrams** are rendered and visually correct before moving to Phase 3

### Phase 3: Slides (Marp)

1. **Read the marp skill** — `.claude/skills/marp-slide/SKILL.md`
2. **Read the template** — `.claude/skills/marp-slide/assets/template-<theme>.md`
3. **Select theme and CSS based on audience:**

   | Audience | Theme variant | font-size | h1::before |
   |----------|--------------|-----------|------------|
   | Simple | tech (clean) | 24px | No prefix |
   | Intermediate | tech (clean) | 24px | No prefix |
   | Technical | tech (terminal) | 22px | `"# "` prefix |

4. **Create the `.md` file** following the marp skill rules:
   - Embed the full `<style>` block from the template
   - Reference diagrams as: `![w:900](diagrams/<deck-name>/01-name.svg)` (SVG preferred; PNG fallback)
   - Follow content density limits (max 5 bullets, max 30 words, max 50 char titles)
   - Use `<!-- _class: lead -->` for title, section breaks, and closing slides
5. **Save** in `docs/presentations/` (default — create on demand) or user-specified directory

### Phase 4: Render Outputs (MANDATORY)

Follow `/marp-slide` **Step 7** for the exact render commands. The contract is identical (both `.html` and `.pptx` MUST be saved beside the `.md` source). This skill does not redefine the commands — running them is part of completing Phase 3.

### Phase 5: Deliver

Report to the user:
- Full file tree of what was created (`.md`, `.html`, `.pptx`, diagrams)
- Theme used and audience level
- Total slide count and diagram count
- Any slides that have no diagram (content-only) so the user knows what to expect

---

## File Structure Produced

Default presentation directory is `docs/presentations/`. Projects may override.

```
docs/presentations/                   ← default; can be overridden
  apresentacao-<name>.md              ← Marp source
  apresentacao-<name>.html            ← rendered HTML (MANDATORY)
  apresentacao-<name>.pptx            ← rendered PPTX (MANDATORY)
  diagrams/
    <name>/
      01-description.excalidraw       ← editable source
      01-description.svg              ← preferred export (SVG > PNG 2x)
      02-description.excalidraw
      02-description.svg
      ...
```

---

## Diagram ↔ Slide Connection Rules

These rules ensure diagrams and slides work together:

| Rule | Value |
|------|-------|
| Frame size | **1280x720** (matches 16:9 slide) |
| Default Marp width | **`![w:900]`** for most diagrams (standard) |
| Marp width with text | `![w:780]` or `![w:560]` depending on text volume |
| Diagram background | White (`#ffffff`) — contrasts with dark slide bg |
| Filename convention | `NN-description.excalidraw` (zero-padded, kebab-case) |
| Max diagrams per deck | No hard limit, but aim for 40-60% of slides having diagrams |
| Diagram depth | Matches audience: simple=conceptual, technical=evidence artifacts |

---

## Quality Checklist

Deck has ONE set of orchestration checks. Slide-quality and diagram-quality checks are owned by the upstream skills — do not duplicate them here.

### Orchestration (deck-only)
| # | Check |
|---|-------|
| 1 | Outline was presented and approved (or inferred from clear instructions) |
| 2 | Every `diagram` slide in the outline has a corresponding `.excalidraw` + `.svg` (or `.png` fallback) |
| 3 | No orphan diagrams (every diagram is referenced by a slide) |
| 4 | Diagram filenames match their slide order (`01-`, `02-`, ...) |
| 5 | All diagrams use 1280x720 frame |
| 6 | All diagrams were rendered and visually validated per `/excalidraw` Render & Validate loop |
| 7 | Color palette is consistent across all diagrams (from `/excalidraw` `references/color-palette.md`) |
| 8 | If the deck mentions production status of the project, `/dogfood` was invoked and returned `EVIDENCE_SUFFICIENT` or `EVIDENCE_WITH_CAVEATS` |

### Downstream checks (delegated)
- **Slides:** run the full Quality Checklist of `/marp-slide` (19 items).
- **Diagrams:** run the full Quality Checklist of `/excalidraw` (27 items, including the Render & Validate loop).

---

## Examples

### Minimal invocation
```
/deck Memoria e Contexto para Agentes de IA
```
→ Infers intermediate audience, pt-BR, 10-16 slides, tech theme.

### Explicit invocation
```
/deck topic="Compaction Pipeline" audience=technical slides=12 lang=pt-BR
```
→ Technical audience, terminal-style headers, 22px font, evidence artifacts in diagrams.

### From existing content
```
/deck baseado no domain.md, versao simplificada para gestores
```
→ Reads domain.md, creates simple version with conceptual diagrams.
