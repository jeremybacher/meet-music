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
4. **The mic button silences you without cutting the music.** While you are playing, Meet Music
   takes over Meet's own microphone button — same place, same look — because Meet's would cut the
   music too, and two mic buttons side by side is a worse answer than one that does the right
   thing. It hands the button back the moment the music stops, or if you mute yourself in Meet
   (only Meet's own button can give the microphone back).

Anyone can jump straight to a queued song with the ▶ next to it, and remove one with ✕. Both are
requests that apply to the whole meeting.

**Use headphones.** Through speakers your microphone picks the music back up and the meeting hears it
twice, slightly out of sync.

### Telling the meeting

When someone joins while you are playing, the extension writes **one readable line** in the chat:

> ♪ Meet Music · now playing "…" · Ana is sharing it through their microphone, so you hear it
> without installing anything. Add songs to the queue with the extension: …

It is the only message aimed at people who **do not** have the extension. Without it, walking into a
meeting where music is already playing is walking into a sound with no visible source and no way to
join in.

Meet's chat shows nothing sent before you arrived, so each arrival gets its own line: people
arriving together share one, and there is never more than one every 30 seconds. It only comes from
whoever is playing, and you can turn it off in ⚙. If Meet's layout changes and the extension can no
longer tell how many people are in the call, ⚙ says so plainly and
*Tell the meeting what is playing*, at the bottom of the player, posts the line by hand.

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

- **Music sounds worse than the original.** Meet encodes the microphone track for speech. While music
  is playing the extension pushes back where it can — it disables Opus DTX and raises the bitrate on
  Meet's outgoing audio so instrumental passages stop cutting out — but the ceiling is still Meet's.
  For the biggest single improvement, turn off **Noise cancellation** in Meet's audio settings: it is
  designed to strip everything that is not a voice.
- **Muting yourself with Meet's button also cuts the music**, because it is a single track. That is
  why the extension takes that button over while you are playing. If Meet's controls move somewhere
  the extension cannot find, the button falls back to its own spot next to the panel launcher.
- **Volume cannot be per-person.** Listeners get the music fused with the player's voice; turning it
  down would turn their voice down too.
- **YouTube ads.** Without Premium they play into the meeting. The extension detects them and lowers
  the volume while they last.
- **Spotify is not possible** in this model: it plays under DRM, and protected audio cannot be
  captured.
- **People without the extension see odd text in the chat** while the queue is shared. The one
  message meant for them — the announcement above — is deliberately readable.
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
  untouched, no `AudioContext` is created and not a single timer runs. When music starts, the mixer
  is built and the track is swapped live with `RTCRtpSender.replaceTrack()`.
- **While there is music, every outgoing audio sender is kept on the mix.** Swapping once is not
  enough: when someone joins, Meet renegotiates — sometimes on a brand-new `RTCPeerConnection` — with
  the raw microphone track. So `addTrack`, `addTransceiver` and `replaceTrack` are all intercepted,
  and a reconciler re-checks every sender each second while music plays. Screen-share audio is
  tracked separately and never touched.
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
pnpm test       # 93 tests
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
| `src/content/meet-participants.ts` | Reads how many people are in the call, to notice someone joining. |
| `src/content/meet-controls.ts` | Meet's mic button: its state, and where it is so ours can take its place. |
| `src/core/announce.ts` | The one plain-text chat line, written for people without the extension. |
| `src/core/crypto.ts` | AES-GCM keyed from the meeting code. |
| `src/core/sdp.ts` | Forces stereo Opus with DTX off — on the internal link, and on Meet's outgoing audio while music plays. |
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

[MIT](LICENSE). Copyright © 2026 Jeremy Bacher.

Playing music in a meeting is the responsibility of whoever plays it. This extension neither
redistributes nor stores audio: it only routes what YouTube is already playing in your own browser.

**Not affiliated with Google.** Meet Music is an independent project, neither affiliated with,
endorsed by nor sponsored by Google. Google Meet, YouTube and Google are trademarks of Google LLC,
used here only to say what the extension works with. The panel is drawn to look at home inside Meet
on purpose, so it says the same thing in its own settings.
