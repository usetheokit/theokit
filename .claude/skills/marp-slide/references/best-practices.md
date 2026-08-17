# Slide Design Best Practices

Guidelines for creating effective presentations, independent of theme.

---

## Content Density

| Rule | Guideline |
|------|-----------|
| Bullets per slide | 3-5 (never more than 6) |
| Words per bullet | 8-12 (fragments, not sentences) |
| Words per slide | Max ~30 total |
| Title length | Max ~50 characters |
| Slides per 10 min | 8-12 slides |
| Code lines per slide | Max 10 (prefer 5-8) |
| Table columns | Max 5 |
| Table rows | Max 6 |

**If a slide has too much content, split it into two.** Never shrink font to fit more.

---

## Slide Structure

### Title Slide
- Use `<!-- _class: lead -->` for centered layout
- Project/talk name as H1
- Author, date, or subtitle as H2
- No bullets

### Content Slides
- H1 for the slide title (one per slide)
- Bullets or short paragraphs for content
- One concept per slide
- If you need "and" to describe the slide, split it

### Code Slides
- Brief intro (1-2 lines) before the code block
- Code block with language tag for syntax highlighting
- 1-2 takeaway bullets after the code
- Never show code without context

### Closing Slide
- Use `<!-- _class: lead -->` again
- "Thank You", "Questions?", or a call to action
- Contact info or links if relevant

---

## Visual Hierarchy

1. **Title** — largest, boldest, top of slide
2. **Key point** — bold text or first bullet
3. **Supporting points** — regular bullets
4. **Details** — smaller text, footnotes, or speaker notes

**Do not make everything the same size.** If everything is emphasized, nothing is.

---

## Flow & Narrative

A good presentation tells a story:

```
1. Context     — Why are we here? What's the problem?
2. Challenge   — What makes this hard? What's at stake?
3. Solution    — What did we do? How does it work?
4. Evidence    — Does it work? Show data/demos
5. Conclusion  — What now? What's the takeaway?
```

Every slide should answer: "Why does this slide exist?"

---

## Tables

- Max 5 columns, 6 rows per slide
- Use bold or color for the most important column
- Align numbers to the right
- Include units in the header, not in every cell

---

## Images & Diagrams

- Use background images for visual impact (`![bg]`)
- Use split layout for image + text (`![bg right:40%]`)
- Always consider: does this image ADD information?
- Decorative images are noise — every image should earn its place

### Standard Sizing

| Scenario | Syntax | Notes |
|----------|--------|-------|
| Full-width diagram | `![w:960](diagram.svg)` | Diagram-only slide, max size |
| **Standard (default)** | **`![w:900](diagram.png)`** | **Most diagrams — use this** |
| Diagram + text | `![w:780](diagram.png)` | Diagram + 1-2 text lines |
| Diagram + bullets | `![w:560](diagram.png)` | Diagram + significant text |
| Split layout | `![bg left:55%](diagram.svg)` | Image left, text right |

### Format Preference

**SVG > PNG 2x > PNG 1x**. SVG is vectorial, scalable, and produces smaller files. Use PNG only as fallback.

### Excalidraw Diagrams

When embedding diagrams created with `/excalidraw`:
- Create with **1280x720 frame** (matches 16:9 slide)
- Export as **SVG** (preferred) or **PNG 2x** (2560x1440)
- Store `.excalidraw` source + export in `diagrams/<name>/` next to the slide
- Always use explicit width: `![w:900](diagrams/<name>/diagram.svg)`

---

## Audience Variants

When creating multiple versions of the same content:

| Aspect | Simple | Technical |
|--------|--------|-----------|
| Audience | General, managers | Engineers, architects |
| Depth | Analogies, concepts | ADRs, specs, numbers |
| Diagrams | Conceptual, few | Detailed, with evidence |
| Code | None or minimal | Real examples |
| Duration | 10-15 min | 20-30 min |
| font-size base | 24px | 22px |

---

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Wall of text | Split into 2-3 slides |
| Reading bullets aloud | Use keywords, explain verbally |
| Inconsistent heading levels | Pick one level (H1) and stick with it |
| Too many fonts/colors | Trust the theme's defaults |
| Slide numbers on title slide | `<!-- _paginate: false -->` |
| No visual breaks | Add a lead slide between major sections |
| Code without context | Add 1-line intro + takeaway |
| Shrinking font to fit | Edit text, never reduce font |
| Diagram without explicit width | Always use `![w:XXXX]` |
| PNG diagrams at 1x | Export at 2x or use SVG |
