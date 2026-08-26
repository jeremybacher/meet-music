---
name: meet-music-design
description: Design and build UI for the Meet Music Chrome extension — the in-call panel that lives inside Google Meet (shadow root, Meet's own visual language, Google blue accent, light + dark) and the extension's own pages (options), which carry the product's violet identity. Use whenever creating, restyling or extending any Meet Music surface: the panel, the floating launcher, banners, sliders and steppers, the queue list, the now-playing block, settings, empty states, the options page, icons, or any user-facing copy. Trigger it for vague asks too — "add a button to the panel", "make this look right", "a new section in settings", "change the colors", "an icon for X" — and whenever theming, Meet-native look, accessibility or panel copy matters.
---

# Meet Music — design

Meet Music has **two visual surfaces**, and they deliberately do not look the same:

| Surface | Where | Looks like |
|---|---|---|
| **The panel** | Injected into `meet.google.com`, in a shadow root | **Google Meet.** Indistinguishable from a native Meet control. |
| **Extension pages** | `options.html`, anything `chrome-extension://` | **Meet Music itself.** Violet accent, neutral dark/light chrome. |

The rule behind the split: *inside someone else's product, be a good guest; in our own pages, be
ourselves.* Never mix the palettes — a violet button in the Meet panel is a bug, and Google blue on
the options page is a borrowed identity we have no claim to.

Panel tokens, options-page tokens, and every component recipe live in
**`references/tokens.md`** and **`references/components.md`**. Icon paths and how to add one live in
**`references/icons.md`**. Read the relevant one before writing CSS or markup.

## Principles

1. **Be a guest in Meet, not a tenant.** The panel copies Meet's language: neutral grey surfaces
   with no tint, Google blue as the only accent, pill buttons, 16px panel radius, circular 48px
   controls with 24px icons, the Google Sans family. When unsure how something should look, open
   Meet and look at the nearest equivalent control — that is the spec.
2. **The panel is an overlay on a call, not an app.** It is 360px wide and capped at
   `min(76vh, 700px)`. Everything must survive that. No horizontal scroll, no layout that assumes
   room. Long titles ellipsise; they never widen the panel.
3. **Say only what is true right now.** Every banner and hint is conditional. There is no permanent
   green "all good" state — if the audio is working there is nothing to report, and a standing
   badge would be noise. Add UI that appears when it has something to say and disappears otherwise.
4. **Technical detail goes in the tooltip, never the surface.** "Audio source: Web Audio",
   `chat open · send button found · sent 4 · received 9` — these matter only when reporting a
   problem, so they live in `title`. The visible line stays in plain language.
5. **The control's shape states its politics.** A slider means fine, personal, continuous control; a
   stepper means each press is an explicit request that changes things *for everyone*. Shared volume
   is a stepper for exactly this reason — and a drag on a shared control would also spray messages
   into the chat. Pick the widget by who it affects, not by what fits.
6. **Both themes, always.** Every colour is a CSS variable defined twice, under
   `.root[data-theme="light"]` and `.root[data-theme="dark"]`. Never write a literal colour in a
   rule. The two exceptions are documented in `references/tokens.md` (Meet's own mute red and the
   activity green) — do not add a third without a reason of the same kind.
7. **State is an attribute, not a class.** `data-active`, `data-muted`, `data-tone`, `data-primary`,
   `data-ducking`. Styling hangs off those. Keep it that way: it reads the same in the JSX and in
   the CSS.

## Working inside the shadow root

- The panel's CSS is a **string** in `src/content/styles.ts`, injected into a shadow root. There is
  no global stylesheet and no build step for it. Add rules there.
- `:host { all: initial; }` resets inheritance from Meet. Anything you need, declare.
- Nothing leaks in either direction — which is the point. Never reach outside the shadow root for
  styling, and never rely on a Meet class name.
- Inline `style` is acceptable only for one-off geometry already used that way in `app.tsx`
  (`margin-top`, a `flex:none` on a single button). Colour, radius, typography and spacing scale
  always come from the tokens.
- `src/content/app.tsx` **only paints.** State lives in `Session` and arrives as a flat
  `SessionView`. If a design needs new state, add it to the view — do not compute it in the JSX.

## Copy voice

The interface talks like a person who understands the constraint and respects the reader:

- **Plain, specific, no jargon.** "No audio is reaching the meeting." Not "Stream inactive."
- **Say what happens next, and offer the button.** "Chrome blocked autoplay in the YouTube tab. One
  click there is enough, and you come right back." + *Go activate it*.
- **Explain the odd thing once, where it bites.** The music rides on the microphone track — so the
  mic-muted banner explains why muting in Meet kills the music, and points at *Mute my voice*.
- **Name the trade-off instead of hiding it.** Sharing the queue writes visible messages into the
  chat, and the settings copy says so.
- **English for everything a user sees. Spanish only for code comments.** No exceptions in either
  direction — and that includes commit messages, which are English too.
- Sentence case everywhere. No exclamation marks. Em dashes and `·` separators are house style.
- Buttons are verbs from the user's side: *Play music here*, *Mute my voice*, *Stop and clear queue*.
  Destructive-ish buttons state their reach in the tooltip ("…for the whole meeting").

## Accessibility

- Every icon-only control needs `aria-label`, and `title` for the pointer. Toggles carry
  `aria-pressed`.
- Decorative SVG is `aria-hidden="true" focusable="false"`; `<img>` thumbnails take `alt=""`.
- Focus is visible on every interactive element: `outline: 2px solid var(--focus-ring)` with an
  offset. Never remove an outline without replacing it.
- Disabled means `disabled` plus a `title` saying why ("Nothing is waiting in the queue"), not a
  greyed-out mystery.
- Hit targets stay at Meet's sizes: 48px for dock buttons, 36px for header icon buttons.

## Checklist before calling a panel change done

- [ ] Reads correctly in **both** themes (switch it in ⚙ → Theme, and check `system` too).
- [ ] No literal colour outside the two token blocks.
- [ ] Fits 360px with a long song title and a long display name — text ellipsises, panel does not grow.
- [ ] New copy is English, sentence case, and says what happens next.
- [ ] Icon-only controls have `aria-label`; toggles have `aria-pressed`.
- [ ] Anything conditional actually disappears when it has nothing to say.
- [ ] Any shared-state control is a stepper/explicit press, not a drag.
- [ ] `pnpm typecheck && pnpm test && pnpm build` still pass.
