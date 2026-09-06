# Components

Every class below is defined in `src/content/styles.ts` and used in `src/content/app.tsx`. Reuse
these before inventing anything; if a new pattern is genuinely needed, add it here too.

## Dock and launcher

The floating controls sit in `.dock` — a row, mirroring Meet's control bar, at `right: 18px;
bottom: 92px`.

```jsx
<button class="launcher" data-active={String(live)} data-muted={String(muted)}
        title={…} aria-label={…} aria-pressed={open}>
  <Icon path={NOTE} standalone />
  {live && <span class="dot" />}
</button>
```

- 48px circle, 24px icon — Meet's own proportions.
- `data-active="true"` → accent fill (the panel is broadcasting).
- `data-muted="true"` → Meet's mute red. Takes precedence visually.
- `.dot` is the 9px activity dot, top-right, ringed in the launcher background so it reads as
  attached to the button. `data-tone="live"` is Meet's activity green (*you* are broadcasting);
  `data-tone="remote"` is `--accent` (music is playing, someone else is the DJ). Two different
  facts, so two different colours — with the panel closed, the dot is the only thing that says
  there is music in the meeting at all.
- The mute launcher **only exists while music plays**. Without music, muting is Meet's own button's
  job and a second one would be a lie.

### The mute button takes over Meet's mic button

While music is on air and you are not muted in Meet, the mute-voice button is not in the dock at
all: it is drawn **exactly on top of Meet's own mic button**, measured from it every 400ms.

```jsx
<button class="launcher" data-overlay="true" data-muted={String(muted)}
        style={`top:${box.top}px;left:${box.left}px;width:${box.width}px;height:${box.height}px;` +
               `background:${box.bg};color:${box.fg};`} />
```

- `position: fixed`, `z-index` and the removed shadow live in the stylesheet; the inline style
  carries **only measurements** — geometry and the colours copied off the button underneath.
- The colours come from `getComputedStyle` on Meet's button, not from our tokens: Meet has its own
  theme and it need not be the one the user picked for the panel. Muted overrides both with Meet's
  red, because that signal must survive.
- The glyph is sized at `50%` of the button, not a fixed 24px — that bar shrinks with the window.
- **Cover, never hide.** Meet's button stays in the DOM and working, so a mispositioned or missing
  overlay degrades to "Meet's button is still there" rather than "there is no mic button".
- It steps aside whenever Meet's own button is the one you need — when you are muted in Meet, only
  Meet's button can give the microphone back.

The reason is not tidiness: with music playing, Meet's mic button silences you *and* the music, and
a second mic button beside it turns the fastest control in the call into a question. One button, in
the place it has always been, doing what the moment calls for.

## Panel shell

```jsx
<div class="panel">
  <header>… <h2>Meet Music</h2> <StatusBadge/> <button class="icon-btn">⚙</button> …</header>
  <div class="body">…</div>
</div>
```

- `header` holds, in order: an optional back arrow, the title (16px/400, `flex: 1`), the status
  badge, then icon buttons. `.body` scrolls; the header does not.
- `.icon-btn` — 36px circle, `--text-dim`, hover fills with `--bg-hover`. Header actions use text
  glyphs (`←`, `⚙`, `✕`); everything in the content area uses a Material path via `<Icon>`.
- Settings is a **view swap inside the same panel**, not a modal: the header title becomes
  "Settings" and a back arrow appears.

## Status badge

```jsx
<span class="badge" data-tone={live ? 'live' : undefined} title={tip}>{label}</span>
```

Answers one question — *whose music is the meeting hearing?* Four states: `On air`
(`data-tone="live"`), `Not on air` (`data-tone="warn"` — the graph is up but no Meet sender carries
the mix, so nobody hears it yet), `DJ: <name>`, `No music`. The tooltip always says the same thing
in a full sentence.

## Banners

```jsx
<div class="banner" data-tone="warn">
  Copy explaining what happened and what is next.
  <button class="action" onClick={…}>The way out</button>
</div>
```

- All banners live inside one `.banners` wrapper, which carries `role="status" aria-live="polite"`
  and collapses to nothing when empty (`.banners:empty`). Banners appear without anyone pressing
  anything, so a screen reader has no other way to learn about them.
- Tones: `warn`, `error`, `info`. Each maps to its `--*-bg` / `--*-text` pair.
- **Controls inside a banner use the banner's palette.** `.banner .action` inherits the banner text
  colour with a `currentColor` border; `data-primary="true"` fills with `--bg`/`--text` so it reads
  as raised on any of the three tinted grounds. `.banner .hint` inherits too, at `opacity: .78`.
  Never let the panel accent sit on the error red.
- A banner that states a problem **carries the button that fixes it**. A banner with no action is a
  dead end. One problem gets one banner: the capture failure and its fallback are the same problem,
  so *Try again* and *Share the tab by hand* sit in one card, not two.
- Banners are conditional. There is no success banner: working audio has nothing to report.
- Two side-by-side choices go in a nested `.controls` with `style="margin-top:10px"`, the
  recommended one `data-primary="true"`.

## Buttons

```jsx
<button class="action" data-primary="true" disabled={…} title={…}>
  <Icon path={PLAY} /> Play
</button>
```

- Pills (`border-radius: 100px`), 14px/500, `flex: 1` inside `.controls`.
- Default: transparent with a `--border` outline and accent text. `data-primary="true"`: accent fill
  with `--accent-text`. One primary per view.
- `disabled` drops opacity to `.38` and must be paired with a `title` explaining why.
- Inline icons render at 18px with `vertical-align:-4px;margin-right:6px` (that is what `<Icon>`
  does without `standalone`).
- `data-icon="true"` — a 46px square icon-only pill for a form row (the add-song `+`). `flex: none`,
  22px glyph centred.
- `data-quiet="true"` — borderless, `--text-dim`, weight 400. For a destructive, low-frequency
  action that must be findable but must not compete: *Stop and clear queue*. Loudness follows how
  often you want it pressed, not how much it does.

## Now playing

`.now` — 48px rounded thumbnail, then `.now-title` (500 weight) and `.now-sub` (12px, faint), both
ellipsised. The sub-line is `elapsed / total` plus `<Attribution>`: `· Meet Music · <who>`.

Attribution shows on **everyone's** songs including your own — the value is that every participant
sees the identical panel, regardless of who is looking.

## Progress bar

A `<button class="progress">`, not a div: it is a seek control, so it must be focusable and
keyboard-reachable. 4px track that grows to 6px on hover, accent fill. `disabled` whenever the
viewer is not authoritative or the duration is unknown — a guest cannot seek someone else's player.

## Volume: slider vs stepper

- `.slider` — **local, continuous, yours.** The three DJ knobs (music in the meeting, music just for
  me, my voice). Head row shows the label and a tabular-nums percentage.
  `data-ducking="true"` appends "· bajando" to the value while auto-ducking is active.
- `.stepper` — **shared, discrete, everyone's.** Down button, tabular-nums level, up button, in 10%
  steps. Used for the shared volume: each press is one deliberate request, and a drag cannot spray
  the chat with messages.

Never swap one for the other without changing who the control affects.

## Queue

`ul`/`li` with `gap: 2px`, rows hovering to `--bg-raised`: 32px thumbnail, ellipsised title with
attribution, `.dur` in tabular nums, and a `.icon-btn` `✕` to remove. The section title carries the
count and the rule: `Queue (3) · anyone can add or skip`.

The list is **not rendered at all** when empty — the blank state (`.stage`) already says what to do
next, and a second empty line under it says it twice.

Each row carries two `.icon-btn`s at 32px (not the header's 36px): a `PLAY` glyph that jumps
straight to that song, and `✕` to remove. Both name the song in their `aria-label` and `title`, so
"Remove" is never ambiguous in a list of ten.

## Blank state and grouping

```jsx
<div class="stage">
  <div class="stage-title">Play music for the whole meeting</div>
  <div class="hint">Paste a YouTube link and the audio is mixed into your microphone…</div>
</div>
```

`.stage` is the only place the product explains itself, and it exists **only** when nothing is
playing and the queue is empty. The moment there is a song, it goes away.

`.group` is a `--bg-sunken` card at 12px radius holding a block of related controls (the three
sliders, or the shared stepper). It separates without a hard border, the way Meet groups inside its
own panels.

`.footer` is a `--border` hairline, then the channel status line and the exit. It sits last because
it is what you touch least.

## Spinner

```jsx
{view.resolving ? <span class="spinner" aria-hidden="true" /> : <Icon path={ADD} standalone />}
```

A 16px `currentColor` ring, so it takes the colour of whatever button it sits in. It is the panel's
only animation beyond the launcher transition, and it is there because a pasted link takes about a
second to resolve its title — a second of no feedback reads as "this is broken". Honours
`prefers-reduced-motion` by slowing to 2.4s rather than stopping, since a frozen spinner is worse
than a slow one.

## Form row

`.row` with a text input (or select) at `flex: 1` and, for the add-song form, a `+` primary pill at
`flex:none;padding:10px 18px`. Inputs are transparent with a `--border` outline; focus swaps the
border to `--accent` and drops the outline.

## Toggles and hints

- `.toggle` — a `<label>` wrapping the checkbox and its text, `align-items: flex-start` so multi-line
  copy hangs correctly. The long explanation goes in a nested `.hint` with `display:block`.
- `.hint` — 12px, `--text-faint`, 1.5 line-height. The place for a trade-off or a caveat.
- `.section-title` — 12px/500, faint, uppercase-free. Groups the block that follows.
