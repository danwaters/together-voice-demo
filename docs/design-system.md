# Design System Reference

A dark-mode-first design system for developer-facing tools and dashboards. Minimal, low-contrast chrome with a single bright accent color. Feels technical but not cold.

---

## 1. Color Palette

### Accent (Brand)

| Token | Hex | Usage |
|---|---|---|
| `--accent` | `#0066FF` | Primary buttons, focus rings, active tabs, links, visualizers |
| `--accent-bright` | `#3385FF` | Hover states on primary elements, highlighted log text |
| `--accent-dim` | `#0052CC` | Active/pressed state on primary buttons |

### Backgrounds (darkest → lightest)

| Token | Hex | Usage |
|---|---|---|
| `--bg-primary` | `#0A0A0B` | Page background |
| `--bg-secondary` | `#111113` | Cards, sections, header, footer |
| `--bg-tertiary` | `#18181B` | Inputs, code blocks, inset panels, canvas areas |
| `--bg-elevated` | `#1F1F23` | Hover state on secondary buttons |

### Text

| Token | Hex | Usage |
|---|---|---|
| `--text-primary` | `#FAFAFA` | Headings, body text, input values |
| `--text-secondary` | `#A1A1AA` | Labels, descriptions, secondary info, log text |
| `--text-tertiary` | `#71717A` | Placeholders, disabled text, timestamps, optional hints |

### Borders

| Token | Hex | Usage |
|---|---|---|
| `--border-color` | `#27272A` | All borders (cards, inputs, dividers) |
| `--border-focus` | `= accent` | Focus ring border color |

### Status

| Token | Hex | Usage |
|---|---|---|
| `--success` | `#22C55E` | Success messages, connected indicators |
| `--error` | `#EF4444` | Error messages, error indicators |
| `--warning` | `#F59E0B` | Loading/connecting indicators |

---

## 2. Typography

### Font Stacks

| Role | Stack | Usage |
|---|---|---|
| Sans | `'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif` | UI text: headings, labels, buttons |
| Mono | `'JetBrains Mono', 'SF Mono', Consolas, monospace` | Inputs, code, logs, technical values |

Load from Google Fonts:
```
DM Sans: 400, 500, 600, 700 (optical size 9–40)
JetBrains Mono: 400, 500
```

### Scale

| Element | Size | Weight | Line height |
|---|---|---|---|
| Body text | 15px | 400 | 1.6 |
| Logo / page title | 24px | 600 | — |
| Section labels / log headers | 12px uppercase, `letter-spacing: 0.5px` | — | — |
| Labels | 13px | 500 | — |
| Input values | 14px (mono) | 400 | — |
| Buttons | 14px (sans) | 600 | — |
| Footer / small text | 13px | 400 | — |
| Log entries | 12px (mono) | 400 | 1.6 |

### Font smoothing

Always apply:
```css
-webkit-font-smoothing: antialiased;
-moz-osx-font-smoothing: grayscale;
```

---

## 3. Spacing Scale

A power-of-2 scale:

| Token | Value |
|---|---|
| `--space-xs` | 4px |
| `--space-sm` | 8px |
| `--space-md` | 16px |
| `--space-lg` | 24px |
| `--space-xl` | 32px |
| `--space-2xl` | 48px |

**Common patterns:**
- Card padding: `--space-lg` (24px)
- Gap between cards/sections: `--space-xl` (32px)
- Gap between form fields (stacked): `--space-md` (16px)
- Gap between label and input: `--space-sm` (8px)
- Inline element gap (icon + text): `--space-sm` (8px)
- Header/footer padding: `--space-lg` vertical, `--space-xl` horizontal

---

## 4. Radii

| Element | Radius |
|---|---|
| Cards / sections | 12px |
| Inputs, buttons, tabs | 8px |
| Small interactive (text buttons) | 4px |
| Status dots | 50% (circle) |

---

## 5. Transitions

| Token | Value | Usage |
|---|---|---|
| `--transition-fast` | `150ms ease` | Hover states, border changes, focus rings |
| `--transition-base` | `250ms ease` | Status color changes, panel transitions |

---

## 6. Component Patterns

### Inputs (text, password, textarea, select)

- Font: mono stack, 14px
- Background: `--bg-tertiary`
- Border: `1px solid --border-color`, radius 8px
- Padding: `8px 16px`
- Focus: border changes to accent, plus `box-shadow: 0 0 0 3px rgba(0, 102, 255, 0.15)`
- Placeholder: `--text-tertiary`
- Textareas: `resize: vertical`, `min-height: 100px`

### Select (custom)

- `appearance: none`
- Chevron SVG as `background-image`, positioned `right 12px center`
- `padding-right: 36px` to clear the chevron
- `cursor: pointer`

### Buttons

**Primary:**
- Background: `--accent`, text: white
- Hover: `--accent-bright`
- Active: `--accent-dim`
- Disabled: `opacity: 0.5`, `cursor: not-allowed`

**Secondary:**
- Background: `--bg-tertiary`, text: `--text-primary`
- Border: `1px solid --border-color`
- Hover: background `--bg-elevated`, border `--text-tertiary`

**Text button:**
- No background/border
- Color: `--text-tertiary`, hover: `--text-secondary`
- Smaller (12px), padding `4px 8px`

**All buttons:**
- `inline-flex`, centered, `gap: 8px` for icon+label
- Font: sans, 14px, weight 600
- Radius: 8px
- Icons: 18px stroke SVGs, `stroke-width: 2`, `fill: none`, `stroke: currentColor`

### Tabs

- Row of pill-shaped buttons (`inline-flex`, radius 8px)
- Inactive: transparent bg, `--border-color` border, `--text-tertiary` text
- Hover: text becomes `--text-secondary`, border `--text-tertiary`
- Active: `--bg-tertiary` bg, accent border + `box-shadow: 0 0 0 1px accent`
- Icons: 16px inline SVGs

### Cards / Sections

- Background: `--bg-secondary`
- Border: `1px solid --border-color`
- Radius: 12px
- Padding: 24px
- Stack vertically with 32px gap

### Status Indicator

- 10px circle
- Colors map to status: tertiary=idle, warning=connecting (pulse 1s), success=connected, accent=streaming (pulse 0.5s), error=error
- Pulse keyframe: `opacity 1 → 0.5 → 1`

### Log / Console

- Mono font, 12px, `line-height: 1.6`
- Background: `--bg-tertiary`, radius 8px, padding 16px
- `max-height: 200px`, `overflow-y: auto`
- Entries are flex rows: `[timestamp] [message]`
- Timestamps in `--text-tertiary`, messages colored by type (info=secondary, success=green, error=red, accent=blue)
- Empty state via `::before` pseudo-element

### Links

- Color: `--accent`, no underline
- Hover: `--accent-bright`

---

## 7. Layout

### Page Structure

```
┌─ header ─────────────────────────────────┐  bg-secondary, border-bottom
│  Logo  │  Subtitle (separated by border) │
├──────────────────────────────────────────┤
│                                          │
│  ┌─ section (card) ─────────────────┐    │  max-width: 900px, centered
│  │  Config / form fields            │    │  gap: 32px between sections
│  └──────────────────────────────────┘    │
│                                          │
│  ┌─ section (card) ─────────────────┐    │
│  │  Main action area                │    │
│  └──────────────────────────────────┘    │
│                                          │
│  ┌─ section (card) ─────────────────┐    │
│  │  Output / status / logs          │    │
│  └──────────────────────────────────┘    │
│                                          │
├──────────────────────────────────────────┤
│  footer                                  │  bg-secondary, border-top
└──────────────────────────────────────────┘
```

- Page: full-height flex column
- Main content: `max-width: 900px`, `margin: 0 auto`, column flex
- Header/footer: full-width, `--bg-secondary`

### Responsive (≤ 640px)

- Header stacks vertically, subtitle loses left border
- `input-row` stacks to column
- Buttons go full-width
- Tabs stack vertically
- Padding shrinks from xl → md

---

## 8. Iconography

- Inline SVGs, 24×24 viewBox
- `fill: none`, `stroke: currentColor`, `stroke-width: 2`
- Sized via CSS: 18px for buttons, 16px for tabs
- Common icons: play (polygon), stop (rect), arrows, circles with plus

---

## 9. CSS Custom Properties Starter

Copy this block into any new project and swap the accent color:

```css
:root {
  --accent: #0066FF;
  --accent-bright: #3385FF;
  --accent-dim: #0052CC;

  --bg-primary: #0A0A0B;
  --bg-secondary: #111113;
  --bg-tertiary: #18181B;
  --bg-elevated: #1F1F23;

  --text-primary: #FAFAFA;
  --text-secondary: #A1A1AA;
  --text-tertiary: #71717A;

  --border-color: #27272A;

  --success: #22C55E;
  --error: #EF4444;
  --warning: #F59E0B;

  --space-xs: 4px;
  --space-sm: 8px;
  --space-md: 16px;
  --space-lg: 24px;
  --space-xl: 32px;
  --space-2xl: 48px;

  --font-sans: 'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif;
  --font-mono: 'JetBrains Mono', 'SF Mono', Consolas, monospace;

  --transition-fast: 150ms ease;
  --transition-base: 250ms ease;
}
```

---

## 10. Key Principles

1. **Dark first, low contrast chrome.** Backgrounds differ by only 1–2 lightness steps. The UI should feel quiet.
2. **One accent color.** Everything interactive shares the same blue. No gradients, no secondary accent.
3. **Mono for data, sans for UI.** Anything the user types or that represents technical values uses the mono stack.
4. **Subtle focus states.** A thin accent border plus a translucent accent glow (`0 0 0 3px rgba(accent, 0.15)`).
5. **Flat, not floating.** Cards are differentiated by background shade and a 1px border, never by drop shadows.
6. **Consistent radii.** 12px for containers, 8px for controls, 4px for small elements.
7. **Animation is functional.** Only animate status indicators (pulse) and transitions on interactive states. No decorative motion.
