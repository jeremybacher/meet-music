# Tokens

## Panel (inside Meet) — `src/content/styles.ts`

Colours are CSS variables declared twice, on `.root[data-theme="light"]` and
`.root[data-theme="dark"]`. `app.tsx` puts the resolved theme on the root div
(`<div class="root" data-theme={view.theme}>`); `src/core/theme.ts` resolves `system` against
`prefers-color-scheme` and keeps watching it. **Read the current values from `styles.ts` before
changing any of them** — this table is the map, that file is the source of truth.

| Variable | Role | Light | Dark |
|---|---|---|---|
| `--bg` | Panel surface | `#ffffff` | `#1e1f20` |
| `--bg-sunken` | Recessed surface | `#f8fafd` | `#131314` |
| `--bg-raised` | Chips, list hover, thumb placeholder | `#f0f4f9` | `#2d2f31` |
| `--bg-hover` | Hover fill, progress track | `#e1e6ec` | `#37393b` |
| `--border` | Hairline borders | `#c4c7c5` | `#444746` |
| `--text` | Primary text | `#1f1f1f` | `#e3e3e3` |
| `--text-dim` | Secondary text, icon buttons | `#444746` | `#c4c7c5` |
| `--text-faint` | Hints, durations, placeholders | `#5f6368` | `#9aa0a6` |
| `--accent` | Google blue: primary fill, focus, slider | `#0b57d0` | `#a8c7fa` |
| `--accent-hover` | Primary hover | `#0842a0` | `#c2ddff` |
| `--accent-text` | Text on the accent fill | `#ffffff` | `#062e6f` |
| `--live` / `--live-text` | "On air" badge | `#d3e3fd` / `#0842a0` | `#0b2a5b` / `#a8c7fa` |
| `--warn-bg` / `--warn-text` | Warning banner | `#fef7e0` / `#8f6100` | `#402d00` / `#fdd663` |
| `--error-bg` / `--error-text` | Error banner | `#fce8e6` / `#a50e0e` | `#4d1f1c` / `#f2b8b5` |
| `--info-bg` / `--info-text` | Info banner | `#e8f0fe` / `#0b57d0` | `#0b2a5b` / `#a8c7fa` |
| `--shadow` | Panel elevation | `0 8px 28px rgba(60,64,67,.22)` | `0 8px 28px rgba(0,0,0,.45)` |
| `--launcher-*` | Dock button bg / hover / fg / on-bg / on-fg | greys + blue | greys + blue |
| `--focus-ring` | Focus outline | `#0b57d0` | `#a8c7fa` |

**The two literal colours, both borrowed from Meet on purpose:**

- `#ea4335` / `#d33426` — the launcher when your voice is muted. It is the exact red Meet uses for a
  cut microphone, and reading as "the same thing Meet means" is the point.
- `#34a853` — the activity dot on the launcher, Meet's own indicator green.

Do not add a third literal unless it is likewise a direct quote of a Meet signal.

### Shape, type, spacing

- **Family:** `"Google Sans", "Google Sans Text", Roboto, system-ui, -apple-system, Arial, sans-serif`
  — applied with `*` inside the shadow root, since nothing is inherited from Meet.
- **Sizes:** panel body 14px · header title 16px/400 · section titles and metadata 12px ·
  hints and list rows 12–13px. Weights stay 400/500; nothing is bold except inline `<strong>`.
- **Radii:** panel 16px · banners 12px · inputs and list rows 8px · thumbnails 8px (48px) and 6px
  (32px) · pills and badges `100px` · circles 50%.
- **Spacing:** panel body `gap: 16px`, sub-groups `gap: 8–10px`, list rows `gap: 2px`.
  Header padding `16px 12px 12px 20px`, body `4px 20px 20px`.
- **Geometry:** panel `width: 360px`, `max-height: min(76vh, 700px)`, anchored `right: 18px;
  bottom: 150px`. Dock at `bottom: 92px`, `gap: 10px`. `z-index: 2147483000`.
- **Motion:** `transition: background-color .15s ease, color .15s ease` on the launcher, and the
  progress track thickening on hover. That is the whole motion budget — no entrance animations.

## Options page — `src/static/options.html`

The extension's own page carries the product identity, not Meet's. Theming is done with a
`:root` block, a `prefers-color-scheme` block guarded by `:root:not([data-theme="light"])`, and a
`:root[data-theme="dark"]` block so the explicit choice wins in both directions.

| Variable | Light | Dark |
|---|---|---|
| `--bg` | `#ffffff` | `#0f0d17` |
| `--panel` | `#f4f2f8` | `#16131f` |
| `--text` | `#1c1830` | `#e8e6f0` |
| `--dim` | `#6b6486` | `#9c96b8` |
| `--border` | `#e0dced` | `#262238` |
| `--accent` | `#6a49f2` | `#7c5cff` |
| `--accent-hover` | `#5a3ae0` | `#6a49f2` |
| `--ok` | `#166534` | `#86efac` |

Type is `system-ui` here, not Google Sans — this page is ours, and the system font is the honest
choice for it. Layout: `max-width: 560px`, centred, sections separated by a top hairline. Radii 8px,
buttons filled with `--accent` and 600 weight.

The page keeps `color-scheme: light dark` so form controls and scrollbars follow along.
