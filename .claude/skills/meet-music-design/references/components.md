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
  attached to the button.
- The mute launcher **only exists while music plays**. Without music, muting is Meet's own button's
  job and a second one would be a lie.

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

Answers one question — *whose music is the meeting hearing?* Three states: `On air` (with
`data-tone="live"`), `DJ: <name>`, `No music`. The tooltip always says the same thing in a full
sentence.

## Banners

```jsx
<div class="banner" data-tone="warn">
  Copy explaining what happened and what is next.
  <button class="action" onClick={…}>The way out</button>
</div>
```

- Tones: `warn`, `error`, `info`. Each maps to its `--*-bg` / `--*-text` pair.
- A banner that states a problem **carries the button that fixes it**. A banner with no action is a
  dead end.
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

Empty state is a `.empty` line that says what to do next: "Empty. Paste a YouTube video link above."

## Form row

`.row` with a text input (or select) at `flex: 1` and, for the add-song form, a `+` primary pill at
`flex:none;padding:10px 18px`. Inputs are transparent with a `--border` outline; focus swaps the
border to `--accent` and drops the outline.

## Toggles and hints

- `.toggle` — a `<label>` wrapping the checkbox and its text, `align-items: flex-start` so multi-line
  copy hangs correctly. The long explanation goes in a nested `.hint` with `display:block`.
- `.hint` — 12px, `--text-faint`, 1.5 line-height. The place for a trade-off or a caveat.
- `.section-title` — 12px/500, faint, uppercase-free. Groups the block that follows.
