# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

**Meet Music** — a Chrome MV3 extension (Preact + TypeScript, bundled with esbuild) that adds a
shared music queue inside Google Meet. The defining constraint: **everyone else in the meeting hears
the music without installing anything**, because the audio is mixed into the microphone track of
whoever is playing.

Every architectural oddity in this repo follows from that one decision. Read `README.md` for the
product-level explanation and `CONTRIBUTING.md` for the manual test checklist.

## Commands

```bash
corepack enable          # this project uses pnpm (packageManager is pinned)
pnpm install
pnpm dev                 # esbuild watch → dist/
pnpm build               # production bundle → dist/
pnpm test                # vitest, 93 tests
pnpm typecheck           # tsc --noEmit
```

Before opening a PR, run exactly what CI runs:

```bash
pnpm typecheck && pnpm test && pnpm build
```

Load `dist/` in `chrome://extensions` with Developer mode on, and hit reload there after each build.
Chrome 116+ is the floor (`minimum_chrome_version` in the manifest).

## Architecture

Four execution contexts, none of which share variables:

```
┌─ Browser of whoever is playing ────────────────────────────────────┐
│  YouTube tab (background)                                          │
│  ├─ [ISOLATED] yt-content: Web Audio over the <video>              │
│  └─ [MAIN]     yt-main: loadVideoById, no reload between songs     │
│            │                                                       │
│            │ local WebRTC          Service worker                  │
│            │ (host candidates)     └─ tab + signalling relay       │
│            ▼                                                       │
│  Meet tab                                                          │
│  ├─ [ISOLATED] panel + transport over the Meet chat                │
│  └─ [MAIN]     getUserMedia patch + mixer                          │
└────────────────────────────────────────────────────────────────────┘
        │ mixed audio, through Meet
        ▼  everyone else, without installing anything
```

- MAIN ↔ ISOLATED talk over `window.postMessage`, filtered by the `BRIDGE` marker in
  `src/core/messages.ts` (Meet posts its own noise on that channel).
- Content scripts ↔ service worker talk over `chrome.runtime` ports (`PORT_MEET`, `PORT_PLAYER`).
- Audio travels YouTube tab → Meet tab over a **local** WebRTC link; both ends are in the same
  browser, so ICE resolves with host candidates and there is no network in between.
- **Host/guest model**: whoever starts the audio is the host and owns the state. Guests emit
  intentions over the chat and paint the last snapshot they received. No CRDT, no conflict
  resolution.

## Invariants

These are load-bearing. Breaking one is either deliberate or a bug — never incidental.

1. **Installed but idle, the extension touches nothing.** With no music, `getUserMedia` returns the
   microphone untouched, no `AudioContext` is created and no timer runs. Anything you add to the
   voice path — a watcher included — must only exist while music is playing.
2. **While there is music, every outgoing audio sender carries the mix.** Meet renegotiates whenever
   somebody joins, sometimes on a brand-new `RTCPeerConnection`, and the new sender comes up with
   the raw microphone. So `addTrack`, `addTransceiver` and `replaceTrack` are intercepted *and* a
   reconciler re-checks every sender each second. Anything that attaches once, at the moment music
   starts, is wrong for the next person through the door. Screen-share audio (`getDisplayMedia`) is
   tracked separately and never replaced.
3. **The voice passes through no processing node**, only a gain. The limiter hangs off the music
   branch; the two branches sum only at the destination. `setLevels({ musicBroadcast })` writes to
   `musicBroadcastGain` and never to `micGain`. `test/mixer.test.ts` verifies the topology.
4. **Meet's DOM is not an API.** Selectors are centralised and heuristic on purpose, and there is
   always a degradation path: if something is not found, the panel says so and keeps working in solo
   mode instead of falling over.
5. **The chat is an expensive channel.** Every message is a visible line for anyone without the
   extension. Before adding a message type, ask whether it is needed and whether it should be
   coalesced (see `LATEST_WINS` and the volume debounce in `chat-transport.ts`).
6. **Sending never clobbers a draft.** If the chat field has text, the send is deferred and the
   draft plus focus are saved and restored.
7. **Encryption is keyed from the meeting code.** AES-GCM authenticates, so anything not produced by
   the extension fails to decrypt and is discarded — that is what stops a participant from typing a
   command into the chat. It does not claim to resist a malicious participant: whoever has the code
   has the key.
8. **Identity and display name are separate.** Each participant has a stable id kept apart from the
   name, so two people on the default name never count as one.
9. **No new dependencies** unless they solve something that cannot reasonably be done by hand. Today
   there are two: `preact` and `esbuild`.

## Conventions

- **Code comments are in Spanish** (the maintainer's language). **Everything else is in English** —
  panel copy, tooltips, options page, README, CONTRIBUTING, **commit messages, branch names and PR
  titles**. Comments are the only Spanish in the repository.
- Comment the **why**, not the what. The comments that earn their keep explain a decision that looks
  odd and is not. Most files open with a doc-comment stating the file's reason to exist; keep that
  shape when adding one.
- **Patterns that search Meet's DOM stay multilingual**, because Meet renders in each user's own
  account language, not the extension's.
- TypeScript is `strict`, with `noUnusedLocals`, `noUnusedParameters` and `noFallthroughCasesInSwitch`.
- Imports of local modules carry the `.js` extension (bundler resolution, ESM-style).
- Preact with the automatic JSX runtime — use `class`, not `className`.
- **Commits follow Conventional Commits, in English**: `feat: share the queue over the Meet chat`,
  `fix: keep the chat draft when sending`, `docs: …`, `chore: …`. Imperative mood, lowercase subject,
  no trailing period. The first commits of this repository predate the rule and are in Spanish — do
  not take them as the model.
- Branches use the same conventional-type prefix and English kebab-case: `feat/shared-queue`,
  `fix/chat-draft`, never the git username.

## Layout

| File | What it does |
|---|---|
| `src/content/mic-patch.ts` | MAIN world. Intercepts `getUserMedia`, returns the mixed track, swaps it live with `replaceTrack()`. |
| `src/content/panel.tsx` | Mounts the panel in a shadow root. |
| `src/content/app.tsx` | The whole panel UI. Pure painting — no logic. |
| `src/content/session.ts` | Panel controller: ports, bridge, transport, queue state, roles. Exposes a flat `SessionView`. |
| `src/content/chat-transport.ts` | Shared queue over the Meet chat, without clobbering drafts. Also the one plain-text line. |
| `src/content/meet-participants.ts` | How many people are in the call, to notice someone joining. |
| `src/content/styles.ts` | The panel's CSS, as a string (shadow root). |
| `src/content/meet-url.ts` | In a call or not; the meeting code. |
| `src/content/meet-identity.ts` | Display name, read from Meet's account button. |
| `src/content/meet-controls.ts` | Meet's mic button: muted or not, and where it is drawn so ours can take its place. |
| `src/core/mixer.ts` | The Web Audio graph. Guarantees the music cannot touch the voice. |
| `src/core/crypto.ts` | AES-GCM keyed from the meeting code. |
| `src/core/wire.ts` | Wire format: `[mm1] base64url(iv‖ciphertext)`, one line. |
| `src/core/protocol.ts` | Message types and validation. |
| `src/core/announce.ts` | The readable chat line, written for people without the extension. |
| `src/core/queue.ts` | Pure reducer for the queue state. |
| `src/core/sdp.ts` | Forces stereo Opus with DTX off on the internal link. |
| `src/core/theme.ts` | Theme preference and system-theme watching. |
| `src/background/service-worker.ts` | YouTube tab lifecycle and signalling relay. |
| `src/player/yt-content.ts` | YouTube side: picks up the audio, drives the `<video>`. |
| `src/player/yt-main.ts` | YouTube MAIN world: changes song without reloading. |
| `src/youtube/parse-url.ts` | videoId out of whatever the user pasted. |
| `src/youtube/oembed.ts` | Title and thumbnail via the public oEmbed endpoint (no API key). |
| `build.mjs` | esbuild: one self-contained IIFE per entry point, plus `src/static/` copied over. |

## Testing

Tests cover what can be isolated: the queue reducer, the protocol, the wire format and encryption,
the mixer (with the fake `AudioContext` in `test/fake-audio.ts`), theming, URL parsing and identity
extraction.

`test/styles.test.ts` guards the design system itself: both theme blocks declare the same tokens, no
literal colour lives outside them beyond the two documented quotes from Meet, and no backtick sneaks
into the `PANEL_CSS` template (one would truncate the stylesheet silently).

**The audio patch and the chat transport are not covered** — they depend on Meet's DOM and on browser
APIs that cannot be simulated faithfully. If you touch either, exercise them by hand with two Google
accounts in a real meeting, following the checklist in `CONTRIBUTING.md`. The panel's diagnostics
(the status line tooltip, and the queue line's `chat open · send button found · sent N · received N`)
are there so failures can be located instead of guessed.

## Gotchas

- **MV3 content scripts cannot be ES modules**, hence one self-contained IIFE per entry in
  `build.mjs`. Nothing is code-split.
- **The MAIN world has no `chrome.*` APIs.** `mic-patch.ts` and `yt-main.ts` reach the extension only
  through `window.postMessage`.
- **`chrome.tabCapture` does not work here.** It can only target tabs where the user *invoked* the
  extension, and a background player tab never qualifies.
- **Audio is taken with `createMediaElementSource`**, not `captureStream()`: it binds to the element
  rather than the resource, so it survives song changes. `captureStream()` is kept as a fallback.
- **Meet is an SPA.** You enter and leave a call without a reload — see `watchCallState`. The panel
  does not mount outside a call, and `document.body` may not exist at `document_idle`.
- **The panel lives in a shadow root** so Meet's CSS cannot reach it and its CSS cannot reach Meet.
  There is no global stylesheet to fall back on.

## Releasing

1. Bump `version` in **both** `src/static/manifest.json` and `package.json`.
2. `git tag v0.2.0 && git push --tags`.

The release workflow builds, tests, **verifies the tag matches the manifest version** and publishes
the ready-to-install zip. CI verifies that the two versions match each other on every PR, so the
only way to get it wrong is the tag itself.

A `Security` workflow runs on every PR and weekly: `pnpm audit` split in two (what ships is held to
`moderate`, the build tooling to `high`) and CodeQL with `security-extended` over the TypeScript
source. `dependency-review` is not there: it needs the repository's Dependency graph enabled, which
it is not.
