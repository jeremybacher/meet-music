# Contributing

## Getting started

This project uses **pnpm**. Node 22 ships it through corepack:

```bash
corepack enable
pnpm install
pnpm dev
```

Load `dist/` in `chrome://extensions` with **Developer mode** on. Hit reload there after each build.

Before opening a PR:

```bash
pnpm typecheck && pnpm test && pnpm build
```

That is exactly what CI runs.

## Testing it for real

**The tests do not cover what breaks most.** The audio patch and the chat transport depend on Meet's
DOM and on browser APIs that cannot be simulated faithfully, so they have to be exercised by hand
with **two Google accounts** in a real meeting (or one normal and one incognito).

If you touched audio or the transport, check at least this:

1. The other account hears the music.
2. With music playing, sweep "Music in the meeting" from 0 to 100 while talking: **your voice volume
   must not change** and you must stay intelligible the whole way.
3. Changing song does not cut the audio or leave the old title behind.
4. *Mute my voice* silences you while the music keeps playing for everyone else.
5. Adding a song from the second account shows up in the first account's queue.

The panel carries diagnostics so you do not have to guess: the status line's tooltip says where the
audio comes from, and the queue line's says `chat open · send button found · sent N · received N`.
When something fails, those numbers say where it breaks.

## How this is meant to hold together

Four decisions worth knowing before touching the code:

- **Installed but idle, the extension does not touch your audio.** With no music, `getUserMedia`
  returns the microphone untouched and no `AudioContext` is even created. If you add something to the
  voice path, make it happen only while music is playing.
- **The voice passes through no processing node**, only a gain. A test verifies the graph topology;
  if you break it, that is either deliberate or a bug.
- **Meet's DOM is not an API.** Selectors are centralised and heuristic on purpose, and there is
  always a degradation path: if something is not found, the extension says so and keeps working in
  solo mode instead of falling over.
- **The chat is an expensive channel.** Every message is a visible line for anyone without the
  extension. Before sending something new, ask whether it is needed and whether it should be
  coalesced (see `LATEST_WINS` and the volume debounce).

## Style

- Code comments are **in Spanish**, the maintainer's language. Everything a user sees is **in
  English**. Pull requests in either language are welcome.
- Patterns that look for things in Meet's DOM are **multilingual**: Meet renders in each user's own
  account language, not the extension's.
- Comment the **why**, not the what. The comments that earn their keep are the ones explaining a
  decision that looks odd and is not.
- No new dependencies unless they solve something that cannot reasonably be done by hand. Today there
  are two: `preact` and `esbuild`.

## Reporting a problem

For audio issues, include:

- What the panel's diagnostics line says (and its tooltip).
- Whether the problem is yours or the listeners' — **they are not the same** and lead to opposite
  diagnoses.
- Chrome version and operating system.

## Cutting a release

1. Bump `version` in `src/static/manifest.json` and `package.json`.
2. Tag it: `git tag v0.2.0 && git push --tags`.

The release workflow builds, runs the tests, **checks that the tag matches the manifest version** and
publishes the ready-to-install zip.
