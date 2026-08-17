# Marp Syntax Reference

Quick reference for Marp-specific markdown directives and syntax.

---

## Frontmatter (Required)

Every Marp file starts with:

```yaml
---
marp: true
theme: uncover       # or default, gaia
paginate: true       # show slide numbers
header: "Header"     # optional: appears on every slide
footer: "Footer"     # optional: appears on every slide
---
```

---

## Slide Separator

Use `---` (three dashes) on its own line to create a new slide.

```markdown
# Slide 1

Content here

---

# Slide 2

More content
```

---

## Directives

### Global (in frontmatter)

| Directive | Effect |
|-----------|--------|
| `marp: true` | Enable Marp engine |
| `theme: uncover` | Set theme |
| `paginate: true` | Show page numbers |
| `header: "text"` | Header on all slides |
| `footer: "text"` | Footer on all slides |
| `size: 16:9` | Aspect ratio (default 16:9, also 4:3) |

### Local (per-slide, via HTML comments)

```markdown
<!-- _class: lead -->       <!-- Apply CSS class to this slide -->
<!-- _paginate: false -->    <!-- Hide page number on this slide -->
<!-- _header: "" -->         <!-- Remove header on this slide -->
<!-- _footer: "" -->         <!-- Remove footer on this slide -->
<!-- _color: white -->       <!-- Change text color for this slide -->
<!-- _backgroundColor: #000 --> <!-- Change background for this slide -->
```

---

## Image Syntax

### Background Images

```markdown
![bg](image.png)                 <!-- Full background -->
![bg fit](image.png)             <!-- Fit to slide -->
![bg cover](image.png)           <!-- Cover (crop to fill) -->
![bg contain](image.png)         <!-- Contain (no crop) -->
![bg auto](image.png)            <!-- Original size -->
![bg 80%](image.png)             <!-- Scale to 80% -->
```

### Split Backgrounds

```markdown
![bg left](image.png)            <!-- Image on left half -->
![bg right](image.png)           <!-- Image on right half -->
![bg left:40%](image.png)        <!-- Image on left 40% -->
![bg right:30%](image.png)       <!-- Image on right 30% -->
```

### Multiple Backgrounds

```markdown
![bg](image1.png)
![bg](image2.png)
<!-- Side by side backgrounds -->
```

### Background Filters

```markdown
![bg blur:3px](image.png)        <!-- Blur -->
![bg brightness:0.7](image.png)  <!-- Darken -->
![bg opacity:0.5](image.png)     <!-- Transparency -->
![bg grayscale](image.png)       <!-- Grayscale -->
![bg sepia](image.png)           <!-- Sepia -->
```

### Inline Images

```markdown
![w:400](image.png)              <!-- Width 400px -->
![h:300](image.png)              <!-- Height 300px -->
![w:400 h:300](image.png)        <!-- Both dimensions -->
```

### Standard Diagram Sizes (Project Convention)

| Scenario | Syntax | When to Use |
|----------|--------|-------------|
| Full-width | `![w:960](d.svg)` | Diagram-only slide, max size |
| **Standard** | **`![w:900](d.png)`** | **Most diagrams (default)** |
| With text | `![w:780](d.png)` | Diagram + 1-2 text lines |
| With bullets | `![w:560](d.png)` | Diagram + significant text |
| Split | `![bg left:55%](d.svg)` | Image left, text right |

**Format preference:** SVG > PNG 2x > PNG 1x.

---

## CSS Classes

### Built-in with `uncover` theme

```markdown
<!-- _class: lead -->    <!-- Centered, larger title layout -->
<!-- _class: invert -->  <!-- Inverted colors -->
```

### Custom classes (define in `<style>`)

```css
section.two-columns {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
}
```

```markdown
<!-- _class: two-columns -->
```

---

## Code Blocks

Standard markdown fenced code blocks with syntax highlighting:

````markdown
```python
def hello():
    print("Hello!")
```
````

---

## Math (KaTeX)

```markdown
Inline: $E = mc^2$

Block:
$$
\sum_{i=1}^{n} x_i = x_1 + x_2 + \cdots + x_n
$$
```

---

## Fragmented Lists (Animations)

Use `*` (asterisk) at the start of list items for step-by-step reveal (only works in HTML export):

```markdown
* First point (appears on click)
* Second point
* Third point
```

---

## Speaker Notes

```markdown
<!-- This is a speaker note. Not visible on slides. -->
```

---

## HTML in Slides

Marp supports inline HTML when `--html` flag is used:

```markdown
<div style="display: flex; gap: 20px;">
  <div>Column 1</div>
  <div>Column 2</div>
</div>
```

Render with: `npx @marp-team/marp-cli slide.md --html`
