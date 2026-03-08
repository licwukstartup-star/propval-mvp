# Cyberpunk Colour Scheme — PropVal MVP

> **Purpose:** This file defines the cyberpunk colour palette for all PropVal reports, UI components, and generated documents. Claude Code should reference this file when applying styles to any output.

---

## Core Palette

### Primary Colours

| Role            | Name           | Hex       | RGB              | Usage                                      |
|-----------------|----------------|-----------|------------------|---------------------------------------------|
| **Neon Cyan**   | Electric Cyan  | `#00F0FF` | `0, 240, 255`    | Primary accent, headings, key data points   |
| **Hot Pink**    | Magenta Pulse  | `#FF2D78` | `255, 45, 120`   | Alerts, warnings, critical highlights       |
| **Deep Purple** | Void Purple    | `#7B2FBE` | `123, 47, 190`   | Secondary accent, gradients, chart fills    |

### Background Colours

| Role              | Name          | Hex       | RGB              | Usage                                       |
|-------------------|---------------|-----------|------------------|----------------------------------------------|
| **Base Dark**     | Midnight      | `#0A0E1A` | `10, 14, 26`     | Primary background                           |
| **Panel Dark**    | Deep Navy     | `#111827` | `17, 24, 39`     | Cards, panels, sidebars                      |
| **Surface**       | Slate Dark    | `#1E293B` | `30, 41, 59`     | Input fields, table rows, elevated surfaces  |
| **Surface Light** | Steel Grey    | `#334155` | `51, 65, 85`     | Borders, dividers, subtle UI elements        |

### Text Colours

| Role              | Name           | Hex       | RGB               | Usage                                      |
|-------------------|----------------|-----------|--------------------|--------------------------------------------|
| **Primary Text**  | Ghost White    | `#E2E8F0` | `226, 232, 240`   | Body text, paragraphs                      |
| **Secondary Text**| Muted Silver   | `#94A3B8` | `148, 163, 184`   | Labels, captions, metadata                 |
| **Bright Text**   | Pure White     | `#FFFFFF` | `255, 255, 255`   | Headings on dark backgrounds               |

### Semantic / Status Colours

| Role          | Name            | Hex       | RGB              | Usage                                       |
|---------------|-----------------|-----------|------------------|----------------------------------------------|
| **Success**   | Neon Green      | `#39FF14` | `57, 255, 20`    | Positive values, confirmations               |
| **Warning**   | Cyber Amber     | `#FFB800` | `255, 184, 0`    | Caution states, moderate risk                |
| **Danger**    | Red Glitch      | `#FF3131` | `255, 49, 49`    | Errors, high risk, negative values           |
| **Info**      | Soft Cyan       | `#67E8F9` | `103, 232, 249`  | Tooltips, informational badges               |

### Accent / Glow Colours

| Role             | Name           | Hex       | RGB              | Usage                                      |
|------------------|----------------|-----------|------------------|--------------------------------------------|
| **Glow Cyan**    | Cyan Glow      | `#00F0FF33` | `0,240,255,0.2`| Box shadows, glowing borders (with alpha)  |
| **Glow Pink**    | Pink Glow      | `#FF2D7833` | `255,45,120,0.2`| Hover states, active element glow          |
| **Glow Purple**  | Purple Glow    | `#7B2FBE33` | `123,47,190,0.2`| Chart area fills, gradient overlays        |
| **Neon Yellow**  | Laser Yellow   | `#FAFF00` | `250, 255, 0`    | Sparse highlight, data callouts            |

---

## Gradient Definitions

```css
/* Primary gradient — headers, hero sections */
--gradient-primary: linear-gradient(135deg, #00F0FF 0%, #7B2FBE 50%, #FF2D78 100%);

/* Subtle background gradient — page/report background */
--gradient-bg: linear-gradient(180deg, #0A0E1A 0%, #111827 100%);

/* Accent bar — section dividers, progress bars */
--gradient-accent: linear-gradient(90deg, #00F0FF 0%, #FF2D78 100%);

/* Card hover — interactive card surfaces */
--gradient-card-hover: linear-gradient(135deg, #1E293B 0%, #7B2FBE22 100%);
```

---

## CSS Custom Properties (Copy into root)

```css
:root {
  /* Core */
  --cp-cyan: #00F0FF;
  --cp-pink: #FF2D78;
  --cp-purple: #7B2FBE;

  /* Backgrounds */
  --cp-bg-base: #0A0E1A;
  --cp-bg-panel: #111827;
  --cp-bg-surface: #1E293B;
  --cp-bg-border: #334155;

  /* Text */
  --cp-text-primary: #E2E8F0;
  --cp-text-secondary: #94A3B8;
  --cp-text-bright: #FFFFFF;

  /* Status */
  --cp-success: #39FF14;
  --cp-warning: #FFB800;
  --cp-danger: #FF3131;
  --cp-info: #67E8F9;

  /* Glow (alpha) */
  --cp-glow-cyan: #00F0FF33;
  --cp-glow-pink: #FF2D7833;
  --cp-glow-purple: #7B2FBE33;

  /* Accent */
  --cp-yellow: #FAFF00;

  /* Gradients */
  --cp-gradient-primary: linear-gradient(135deg, #00F0FF 0%, #7B2FBE 50%, #FF2D78 100%);
  --cp-gradient-bg: linear-gradient(180deg, #0A0E1A 0%, #111827 100%);
  --cp-gradient-accent: linear-gradient(90deg, #00F0FF 0%, #FF2D78 100%);

  /* Typography */
  --cp-font-heading: 'Orbitron', 'Rajdhani', sans-serif;
  --cp-font-body: 'Inter', 'Roboto', sans-serif;
  --cp-font-mono: 'JetBrains Mono', 'Fira Code', monospace;

  /* Borders & Shadows */
  --cp-border-glow: 0 0 8px var(--cp-glow-cyan), 0 0 20px var(--cp-glow-cyan);
  --cp-border-radius: 8px;
}
```

---

## Tailwind CSS Mapping

```js
// tailwind.config.js — extend your theme
module.exports = {
  theme: {
    extend: {
      colors: {
        cyber: {
          cyan: '#00F0FF',
          pink: '#FF2D78',
          purple: '#7B2FBE',
          green: '#39FF14',
          amber: '#FFB800',
          red: '#FF3131',
          yellow: '#FAFF00',
          info: '#67E8F9',
        },
        dark: {
          base: '#0A0E1A',
          panel: '#111827',
          surface: '#1E293B',
          border: '#334155',
        },
        text: {
          primary: '#E2E8F0',
          secondary: '#94A3B8',
          bright: '#FFFFFF',
        },
      },
      fontFamily: {
        heading: ['Orbitron', 'Rajdhani', 'sans-serif'],
        body: ['Inter', 'Roboto', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      boxShadow: {
        'glow-cyan': '0 0 8px #00F0FF33, 0 0 20px #00F0FF33',
        'glow-pink': '0 0 8px #FF2D7833, 0 0 20px #FF2D7833',
        'glow-purple': '0 0 8px #7B2FBE33, 0 0 20px #7B2FBE33',
      },
    },
  },
};
```

---

## Application Rules for Claude Code

When applying this scheme to PropVal reports and components:

1. **Dark mode is default.** Always use `--cp-bg-base` or `--cp-bg-panel` as the background. Never use white or light backgrounds.
2. **Headings get neon treatment.** Use `--cp-cyan` for H1/H2, `--cp-text-bright` for H3+. Apply `font-heading` (Orbitron/Rajdhani).
3. **Data should glow.** Key valuation figures, prices, and metrics use `--cp-cyan` or `--cp-pink` with a subtle `text-shadow` glow.
4. **Tables use alternating dark rows.** Alternate between `--cp-bg-panel` and `--cp-bg-surface`. Header row uses `--cp-gradient-accent`.
5. **Charts follow accent hierarchy.** Primary series: cyan → Secondary: pink → Tertiary: purple → Quaternary: green.
6. **Borders are subtle.** Use `--cp-bg-border` for most borders. Reserve glowing borders (`--cp-border-glow`) for focused/active elements only.
7. **Status colours are semantic.** Green = positive/pass, Amber = caution, Red = fail/risk. Never swap these.
8. **Gradients are used sparingly.** `--cp-gradient-primary` for hero/header areas only. `--cp-gradient-accent` for dividers and progress bars.
9. **Body text stays readable.** Always `--cp-text-primary` on dark backgrounds. Never place neon text on neon backgrounds.
10. **Glow effects are restrained.** Use glow shadows on hover/focus states, not statically. Exception: key valuation figure callouts.

---

## Quick Reference — Common Component Styles

```
Page background:     #0A0E1A
Card background:     #111827
Card border:         #334155
Heading text:        #00F0FF (Orbitron)
Body text:           #E2E8F0 (Inter)
Caption text:        #94A3B8
Primary button:      bg #00F0FF, text #0A0E1A
Danger button:       bg #FF3131, text #FFFFFF
Link colour:         #00F0FF (hover: #FF2D78)
Table header bg:     gradient cyan→pink
Table row alt:       #1E293B
Positive value:      #39FF14
Negative value:      #FF3131
Chart line 1:        #00F0FF
Chart line 2:        #FF2D78
Chart line 3:        #7B2FBE
Chart fill (area):   #7B2FBE33
```
