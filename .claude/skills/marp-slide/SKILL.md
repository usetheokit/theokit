---
name: marp-slide
description: Create Marp presentation slides with embedded CSS theme — outputs self-contained .md + rendered .html + .pptx. Use when the user wants slides only (no full deck with diagrams; for that use /deck).
user-invocable: true
allowed-tools: Read Glob Grep Bash Write Edit
argument-hint: "<topic or file>"
---

# Marp Slide Creator

> **INQUEBRÁVEL — 95% Confidence Gate**
>
> NÃO FAÇA NADA SE NÃO TIVER 95% DE CONFIANÇA.
> SEMPRE QUE PRECISAR DE UMA DECISÃO DO USUÁRIO, APRESENTE
> OPÇÕES PARA ELE ESCOLHER.
>
> Ver `/home/paulo/.claude/CLAUDE.md` § 1 (95% Confidence).

Generate Marp presentations with embedded CSS themes. No external files needed — each output is a self-contained `.md` ready for Marp CLI or VS Code.

**Project standard (optional, in this priority):**
1. If `.claude/rules/public-copy.md` exists, **READ IT FIRST** — voice rules apply to slides that mirror public README/PITCH copy.
2. If `docs/presentations/PADRAO-APRESENTACOES.md` OR `materiais/apresentacoes/PADRAO-APRESENTACOES.md` exists, read it for layout/typography conventions.
3. Otherwise, infer theme/typography/colors from audience + content.

**Project rules consumed:**
- `.claude/rules/public-copy.md` — voice for slides that surface in README/PITCH.
- `.claude/rules/dogfood-golden-rule.md` — NEVER produce slides claiming "production-ready" / "v1.0" / "production-grade" for the project without recorded dogfood evidence. Apply the gate before generating any status-claim slide.

---

## When to Trigger

- User asks to create slides, a presentation, or a deck
- User mentions Marp explicitly
- User says "make slides about X", "presentation about X", "create a presentation"

---

## Workflow

### Step 1: Understand the Request

Before creating anything, clarify:
- **Topic** — what the presentation is about
- **Audience** — technical, business, academic, general?
- **Length** — how many slides? (default: 8-12)
- **Language** — pt-BR, en, etc.

If the user is vague, infer from context. Only ask if genuinely ambiguous.

### Step 2: Select Theme

Read `references/theme-selection.md` for the decision matrix. Quick guide:

| Content Type | Theme | Why |
|---|---|---|
| General / lectures | `default` | Clean, versatile |
| Academic / data-heavy | `minimal` | Content-focused, no distraction |
| Creative / events | `colorful` | Vibrant, energetic |
| Evening / modern look | `dark` | Eye-friendly, stylish |
| Visual-focused | `gradient` | Bold, immersive |
| Programming / dev talks | `tech` | Code-friendly, dark |
| Corporate / proposals | `business` | Professional, structured |

### Step 3: Load Template

Read the corresponding template from `assets/template-<theme>.md`. The template contains:
- Marp frontmatter (`marp: true`, `theme: uncover`, etc.)
- Full embedded `<style>` block
- Example slide structure

### Step 4: Create Slides

Using the template's CSS and structure as base, create the presentation:

**Slide structure rules:**
1. **Title slide** — use `<!-- _class: lead -->` for centered hero layout
2. **3-5 bullet points per slide** — never more than 6
3. **One idea per slide** — if you need "and" to describe it, split it
4. **Consistent formatting** — same heading level, same bullet style throughout
5. **Logical flow** — Introduction -> Body -> Conclusion/CTA

**Content rules:**
- Titles: concise, max ~50 characters
- Bullets: fragments, not full sentences (unless quoting)
- Use `---` between slides (Marp page separator)
- Add speaker notes with `<!-- speaker notes here -->` when useful

### Step 5: Add Visuals (if applicable)

Use Marp image syntax from `references/marp-syntax.md`:

```markdown
![bg right:40%](image.png)      <!-- Side image -->
![bg](image.png)                 <!-- Full background -->
![w:600](image.png)              <!-- Inline, sized -->
![bg blur:3px](image.png)        <!-- Background with filter -->
```

Only add image placeholders if the user provides images or asks for them.

#### Standard Image/Diagram Dimensions

Use these standard widths for consistent sizing across slides:

| Scenario | Syntax | Notes |
|----------|--------|-------|
| Full-width diagram | `![w:960](diagram.svg)` | Diagram-only slide, max size |
| **Standard (default)** | **`![w:900](diagram.png)`** | **Most diagrams — use this** |
| Diagram + text | `![w:780](diagram.png)` | When slide has 1-2 lines of text too |
| Diagram + bullets | `![w:560](diagram.png)` | When slide has significant text |
| Split layout | `![bg left:55%](diagram.svg)` | Image left, text right |

**Format preference:** SVG > PNG 2x > PNG 1x. SVG is vectorial and scales to any resolution.

#### Excalidraw → Marp Pipeline

When diagrams are created with the `/excalidraw` skill:

1. Create the diagram with a **1280x720 frame** (matches slide aspect ratio)
2. Export as **SVG** (preferred) or **PNG at 2x scale** (2560x1440)
3. Enable **"Embed Scene"** in export (preserves editability)
4. Store files at `diagrams/<presentation-name>/` next to the slide `.md`
5. Keep the `.excalidraw` source alongside exports
6. Reference in markdown: `![w:900](diagrams/<name>/diagram.svg)`

#### Icons in slides

For inline semantic icons (next to titles, in bullets, in tables), use the curated library at `../../.claude/skills/excalidraw/references/icons/`. Three approaches:

**Approach A: Image reference (simplest, works without `html: true`)**

```markdown
![w:32 h:32](../../.claude/skills/excalidraw/references/icons/lucide/brain.svg)
```

Icons are already recolored to the Theo palette. To use a different color, copy the SVG and edit the `stroke` (Lucide/Tabler) or `fill` (Simple Icons/Phosphor) attribute.

**Approach B: Inline SVG with `currentColor` (requires `html: true`)**

Add `html: true` to frontmatter, then:

```html
<style>
.icon { width: 1.2em; height: 1.2em; vertical-align: middle; display: inline-block; }
.icon svg { width: 100%; height: 100%; }
.icon-purple { color: #a855f7; }
.icon-accent { color: #fbbf24; }
.icon-success { color: #3fb950; }
</style>

# Memory Store <span class="icon icon-purple"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="..."/></svg></span>
```

Paste the SVG body (paths only) from `_raw/<name>.svg` so `currentColor` is preserved and follows the surrounding text color. Wrap in `<div>` or `<span>` — bare `<svg>` may not render due to a Marp parsing quirk.

**Approach C: Brand logos in `<!-- _class: lead -->` title slides**

For "Powered by ..." or "Integrates with ..." style slides, reference Simple Icons directly:

```markdown
![h:64](../../.claude/skills/excalidraw/references/icons/simple-icons/anthropic.svg) ![h:64](../../.claude/skills/excalidraw/references/icons/simple-icons/python.svg)
```

#### When to use icons in slides

- Section title: 1 icon next to the h1 to anchor the theme
- Comparison table: 1 icon per row in the leftmost column
- Bullet list: only if every bullet has one (consistency) — otherwise none
- Avoid: decorative icons that don't add meaning, multiple icons in a single bullet, mixing line + duotone in the same slide

### Step 6: Save Output

Save the `.md` file in the **current working directory** (or where the user specifies). Name it descriptively: `apresentacao-cloud-computing.md`, `q1-results-deck.md`, etc.

#### File Organization

```
<presentation-dir>/
  apresentacao-<name>.md           ← Marp source
  apresentacao-<name>.html         ← rendered HTML (MANDATORY)
  apresentacao-<name>.pptx         ← rendered PowerPoint (MANDATORY)
  diagrams/
    <name>/
      01-description.excalidraw    ← editable source
      01-description.svg           ← preferred export
      01-description.png           ← fallback (2x scale)
```

### Step 7: Render HTML and PowerPoint (MANDATORY)

**After saving the `.md` file, you MUST generate both HTML and PPTX outputs.** This is not optional — every presentation must be delivered with both rendered formats ready to use.

```bash
# Generate HTML (for browser presentation)
npx @marp-team/marp-cli <file>.md --html --allow-local-files

# Generate PowerPoint (for sharing and offline use)
npx @marp-team/marp-cli <file>.md --pptx --allow-local-files
```

If `npx @marp-team/marp-cli` is not available, install it first:
```bash
npm install -g @marp-team/marp-cli
```

**Both files must be saved in the same directory as the `.md` source.**

### Step 8: Inform the User

Tell the user:
- Where the `.md`, `.html`, and `.pptx` files were saved
- Which theme was used and why
- That the HTML can be opened in any browser for presentation
- That the PPTX can be opened in PowerPoint/Google Slides for editing

---

### Audience Variants

When creating multiple versions of the same presentation:

| Aspect | Simple Version | Technical Version |
|--------|---------------|-------------------|
| **Audience** | General, managers | Engineers, architects |
| **Depth** | Analogies, concepts | ADRs, specs, numbers |
| **Diagrams** | Conceptual, few | Detailed, with evidence artifacts |
| **Code** | None or minimal | Code blocks with real examples |
| **Tables** | Simple, 2-3 columns | Detailed, with technical values |
| **Duration** | 10-15 min | 20-30 min |
| **h1::before** | No prefix (`content: ""`) | Terminal style (`content: "# "`) |
| **font-size base** | 24px | 22px (more content per slide) |

---

## Quality Checklist

Before delivering, verify:

| # | Check | Rule |
|---|---|---|
| 1 | Title slide has `<!-- _class: lead -->` | Hero layout |
| 2 | Max 5 bullets per slide | Readability |
| 3 | Max ~50 char titles | Scannability |
| 4 | Max ~30 words per slide | Content density |
| 5 | `---` separates every slide | Marp requirement |
| 6 | Frontmatter has `marp: true` | Required |
| 7 | `<style>` block is complete and embedded | Self-contained |
| 8 | No orphan slides (1 bullet or empty) | Content density |
| 9 | Logical intro -> body -> conclusion flow | Narrative |
| 10 | Consistent heading levels throughout | Visual consistency |
| 11 | Speaker notes where complex points need context | Presenter aid |
| 12 | Diagrams exported as SVG (or PNG 2x) | Resolution |
| 13 | `.excalidraw` originals stored alongside exports | Editability |
| 14 | Images use explicit `![w:XXXX]` width | Consistent sizing |
| 15 | Code blocks have language tag for syntax highlighting | Readability |
| 16 | Icons (if used) come from `references/icons/` library | Icon consistency |
| 17 | If using inline `<svg>`, frontmatter has `html: true` | Marp requirement |
| 18 | HTML output generated and saved | **Mandatory** |
| 19 | PPTX output generated and saved | **Mandatory** |

---

## File Structure

```
marp-slide/
├── SKILL.md                      # This file — agent instructions
├── assets/
│   ├── template-default.md       # Clean beige theme
│   ├── template-minimal.md       # Ultra-clean white
│   ├── template-colorful.md      # Vibrant gradients
│   ├── template-dark.md          # Dark with glow accents
│   ├── template-gradient.md      # Per-slide gradient backgrounds
│   ├── template-tech.md          # Code-friendly dark theme
│   └── template-business.md      # Corporate professional
└── references/
    ├── marp-syntax.md            # Marp directives and image syntax
    ├── theme-selection.md        # Theme decision matrix
    └── best-practices.md         # Slide design guidelines
```

---

## Rendering Commands

```bash
# HTML + PPTX (MANDATORY — always generate both)
npx @marp-team/marp-cli slide.md --html --allow-local-files
npx @marp-team/marp-cli slide.md --pptx --allow-local-files

# PDF (optional, on user request)
npx @marp-team/marp-cli slide.md --pdf --allow-local-files

# Watch mode (for development only)
npx @marp-team/marp-cli slide.md --html --watch
```

**Rule:** Every `/marp-slide` invocation MUST produce `.html` and `.pptx` alongside the `.md` source. PDF is generated only when explicitly requested.
