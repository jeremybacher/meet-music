# Meet Music

Shared music queue inside Google Meet. **Everyone else hears it without installing anything**: the
audio is mixed into the microphone track of whoever is playing.

> The extension UI and this documentation are in English. Code comments are in Spanish, the
> maintainer's language. Patterns that look for elements in Meet's DOM stay multilingual on purpose,
> because Meet renders in each user's own account language.

---

## Install

**From a release** (recommended, nothing to compile):

1. Download the `.zip` from the [latest release](../../releases/latest) and unzip it.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and pick the unzipped folder.

Keep the folder around: Chrome loads the extension from it, so deleting it uninstalls the extension.

**From source**:

```bash
corepack enable   # this project uses pnpm
pnpm install
pnpm build        # everything lands in dist/
```

Then load `dist/` with the same steps.

Requires Chrome 116 or newer.

---

## Use

Join a Meet call and a music-note button appears next to the controls. The panel does not exist
outside a call.

1. **Paste a YouTube video link.** There is no search by name in this version.
2. **Play music here** opens a YouTube tab with that song and starts mixing. The first time, Chrome
   may need a click in that tab to allow audio — the panel tells you and takes you there, and you
   come right back.
3. **Set the volume.** Whoever is playing gets three independent knobs — music in the meeting, music
   just for them, and their own voice. Everyone else gets up and down buttons, which change the
   volume for the whole meeting.
4. **Mute my voice** silences you without cutting the music. Meet's own mute button cannot do that,
   because music and voice travel as a single mixed track.

**Use headphones.** Through speakers your microphone picks the music back up and the meeting hears it
twice, slightly out of sync.

### Shared queue

For others to add songs they need **this same extension installed**. The queue travels through the
Meet chat, in encrypted and hidden messages: it is the only channel participants share when there is
no server.

**Anyone can add, skip, pause and change the volume.** No voting, no permissions — the queue belongs
to the meeting, not to whoever started it. **Stop and clear queue** stops the music, empties the queue
and frees the spot, so anyone can start from scratch.

The Meet chat panel **is kept open** while this is on: with the panel closed Meet does not even mount
incoming messages, so you would stop receiving what others do. If you close it three times, the
extension stops insisting and lets you choose.

You can turn it off in ⚙ → *Share the queue with the meeting*, at the cost of losing the shared queue.

---

## Known limitations

None of these are bugs — they follow from injecting audio into the microphone.

- **Music sounds worse than the original.** Meet encodes the microphone track for speech. That is the
  price of nobody else having to install anything.
- **Muting yourself with Meet's button also cuts the music**, because it is a single track. That is
  what *Mute my voice* is for.
- **Volume cannot be per-person.** Listeners get the music fused with the player's voice; turning it
  down would turn their voice down too.
- **YouTube ads.** Without Premium they play into the meeting. The extension detects them and lowers
  the volume while they last.
- **Spotify is not possible** in this model: it plays under DRM, and protected audio cannot be
  captured.
- **People without the extension see odd text in the chat** while the queue is shared.
- **If the player closes their tab without stopping**, everyone else keeps seeing them as the DJ until
  someone uses *Stop and clear queue*.
- **Meet's DOM changes without notice.** If the chat transport breaks, the extension degrades to
  solo mode instead of falling over.

---

## How it works

Google Meet exposes no extension API, so there is no official way to inject audio. The extension
intercepts `getUserMedia` on the Meet page and hands back a mixed track: your voice plus the music.

```
┌─ Browser of whoever is playing ────────────────────────────────────┐
│  YouTube tab (pinned, in the background)                           │
│  └─ content script: Web Audio over the <video>                     │
│            │                                                       │
│            │ local WebRTC          Service worker                  │
│            │ (host candidates)     └─ signalling relay             │
│            ▼                                                       │
│  Meet tab                                                          │
│  ├─ [ISOLATED] panel + transport over the Meet chat                │
│  └─ [MAIN] getUserMedia patch + mixer                              │
└────────────────────────────────────────────────────────────────────┘
        │ mixed audio, through Meet
        ▼  everyone else, without installing anything
```

### The audio

It is picked up with `createMediaElementSource` over the `<video>` of a real YouTube page. Unlike
`captureStream()`, that binds **to the element** rather than to the resource, so it survives song
changes; `captureStream()` is kept as a fallback. On a real page, ad detection is also reliable (the
`ad-showing` class) instead of a heuristic.

**`chrome.tabCapture` does not work here**: it can only target tabs where the user has *invoked* the
extension (toolbar icon, shortcut, context menu), and a background player tab never qualifies.

Two deliberate decisions about the voice:

- **While there is no music, the extension touches nothing.** `getUserMedia` returns the microphone
  untouched and no `AudioContext` is even created. When music starts, the mixer is built and the
  track is swapped live with `RTCRtpSender.replaceTrack()`.
- **The voice passes through no processing node**, only a gain. The limiter hangs off the music
  branch. A test verifies that topology.

### The transport

Messages are **encrypted with AES-GCM**, keyed from the **meeting code**: a secret everyone inside
already shares and nobody outside has, with nothing to configure.

- The queue is unreadable to anyone not in that meeting.
- **Nobody can inject commands by typing in the chat**: AES-GCM authenticates, so a message that did
  not come from the extension fails to decrypt and is discarded.
- Sending **never overwrites what you are typing**: if the field has text the send is deferred, and
  the draft and focus are saved and restored.

It does not claim to resist a malicious participant of the meeting itself: whoever has the code has
the key.

Each participant has a **stable id** kept separate from the display name. They are separate on
purpose: if identity were the name, two people on the default name would count as one.

---

## Development

```bash
pnpm dev        # esbuild in watch mode
pnpm test       # 61 tests
pnpm typecheck
pnpm build
```

Reload the extension in `chrome://extensions` after each build.

Tests cover what can be isolated: the queue reducer, the protocol, the encryption, the mixer (with a
fake `AudioContext`), theming and URL parsing. **The audio patch and the chat transport are verified
by hand**, with two Google accounts in a real meeting.

### Layout

| File | What it does |
|---|---|
| `src/content/mic-patch.ts` | MAIN world. Intercepts `getUserMedia` and returns the mixed track. |
| `src/core/mixer.ts` | The Web Audio graph. Guarantees the music cannot touch the voice. |
| `src/content/session.ts` | Panel state, roles, wiring. |
| `src/content/chat-transport.ts` | Shared queue over the Meet chat, without clobbering your drafts. |
| `src/core/crypto.ts` | AES-GCM keyed from the meeting code. |
| `src/core/sdp.ts` | Forces stereo Opus with DTX off on the internal link. |
| `src/background/service-worker.ts` | YouTube tab and signalling relay. |
| `src/player/yt-content.ts` | YouTube side: picks up the audio and drives the `<video>`. |
| `src/player/yt-main.ts` | YouTube MAIN world: changes song without reloading. |

### The icon

The PNGs in `src/static/icons/` are generated with headless Chrome from the **same Material
`music_note` path** the floating button inside Meet uses, so they read as the same thing.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE).

Playing music in a meeting is the responsibility of whoever plays it. This extension neither
redistributes nor stores audio: it only routes what YouTube is already playing in your own browser.
