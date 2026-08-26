# Icons

## The system

Material Symbols paths on a `0 0 24 24` viewBox, drawn with `fill: currentColor` — the same icon
language as Meet's own controls. There is **no icon dependency**: paths are string constants at the
bottom of `src/content/app.tsx`.

```jsx
const Icon = ({ path, standalone }) =>
  standalone
    ? <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d={path} /></svg>
    : <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" width="18" height="18"
           style="fill:currentColor;vertical-align:-4px;margin-right:6px"><path d={path} /></svg>
```

- `standalone` → the icon *is* the button (launcher, stepper). Sized by CSS: 24px in `.launcher`,
  20px in `.stepper`.
- default → the icon sits **before a label** inside a pill, at 18px with optical alignment.

## Paths in use

| Constant | Material name | Where |
|---|---|---|
| `NOTE` | `music_note` | Launcher, and the extension icon |
| `MIC` / `MIC_OFF` | `mic` / `mic_off` | Mute-voice launcher and pill |
| `VOL_DOWN` / `VOL_UP` | `volume_down` / `volume_up` | Shared volume stepper |
| `PLAY` / `PAUSE` | `play_arrow` / `pause` | Transport |
| `SKIP` | `skip_next` | Next |
| `HEADSET` | `headset` | "Play music here" |

Header actions (`←`, `⚙`, `✕`) are plain text glyphs, not paths. Keep it that way — they are chrome,
not content.

## Adding one

1. Take the path from Material Symbols at 24px, filled, weight 400 — same family as the ones above,
   or it will read as foreign next to them.
2. Add it as a `const` beside the others in `app.tsx`, named after what it means here, not after the
   glyph.
3. Render through `<Icon>`. Never inline a raw `<svg>` in a component.
4. Icon-only? It needs `aria-label` and `title`.

## The extension icon

The PNGs in `src/static/icons/` (16/32/48/128) are generated with headless Chrome from the **same
`music_note` path** the launcher uses, so the toolbar icon and the in-call button read as the same
object. If the launcher glyph ever changes, regenerate them — a mismatch there is a real bug, not a
detail.
