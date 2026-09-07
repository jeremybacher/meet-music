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

That is exactly what CI runs — plus a check that `manifest.json` and `package.json` agree on the
version, since they are bumped by hand and drift apart on their own.

A second workflow, **Security**, runs on every PR and on its own every Monday: `pnpm audit` over
what ships and over the build tooling, and CodeQL over the source. Nothing to run locally, but
`pnpm audit` gives you the same answer as the first half of it.

## Testing it for real

**The tests do not cover what breaks most.** The audio patch and the chat transport depend on Meet's
DOM and on browser APIs that cannot be simulated faithfully, so they have to be exercised by hand
with **two Google accounts** in a real meeting (or one normal and one incognito).

If you touched audio or the transport, check at least this:

1. The other account hears the music.
2. **Start the music alone, and have the second account join afterwards.** They must hear it without
   anyone leaving and rejoining. This is the case that used to fail: Meet renegotiates when someone
   joins, and the new sender came up with the raw microphone track. Do the reverse order too.
3. Leave and rejoin with the second account a couple of times while the music keeps playing.
4. With music playing, sweep "Music in the meeting" from 0 to 100 while talking: **your voice volume
   must not change** and you must stay intelligible the whole way.
5. Changing song does not cut the audio or leave the old title behind.
6. *Mute my voice* silences you while the music keeps playing for everyone else.
7. Adding a song from the second account shows up in the first account's queue.
8. The second account sees the queue **as soon as it joins**, without opening the chat by hand.
9. The chat gets exactly **one** readable announcement per join — within a few seconds, not a
   minute later — and none at all when nobody joins. Open ⚙: it says how many people the extension
   is reading in the call. If it says it cannot tell, the join detection is broken and everything
   below it is guesswork.
10. Share a tab with audio while music is playing: the shared tab's sound still reaches the meeting.
11. Start the music with your microphone off in Meet: the badge says *Not on air*, and turning the
    mic on brings the music in without pressing anything again.
12. With music playing, there is **one** mic button, in Meet's own control bar, and pressing it
    silences you without cutting the music. Resize the window and go full screen: it stays glued to
    Meet's button. Mute yourself with Meet's keyboard shortcut and the button goes back to being
    Meet's, so you can unmute.

The panel carries diagnostics so you do not have to guess: the audio line's tooltip says where the
audio comes from and **how many Meet senders are carrying the mix** (`senders carrying the mix: N`
— zero while music plays means nobody hears it), and the footer's says
`chat open · send button found · sent N · received N`. When something fails, those numbers say where
it breaks.

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
  coalesced (see `LATEST_WINS`, the volume debounce, and the 90-second floor on announcements).
- **Whoever joins must be caught up without doing anything.** Meet renegotiates audio and remounts
  the chat as people come and go; anything that is set up once, at the moment music starts, will be
  wrong for the next person through the door. Reconcile, do not assume.

## Style

- Code comments are **in Spanish**, the maintainer's language. **Everything else is in English**:
  what a user sees, the documentation, and **commit messages, branch names and PR titles**.
- Commits follow **Conventional Commits** — `feat:`, `fix:`, `docs:`, `chore:` — imperative mood and
  lowercase subject. Branches carry the same prefix: `feat/shared-queue`, `fix/chat-draft`.
- The conversation on an issue or a pull request can be in either language.
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

There is nothing to cut: **the PR carries the version and merging publishes it.**

Open the PR as usual. The `Version` workflow reads the type of the change and pushes a
`chore(release): vX.Y.Z` commit **to your own branch**, with both `version` fields written — so you
see the number in the diff before it means anything. Merge, and a second job tags what landed and
publishes the ready-to-install zip.

| Type | Bump |
|---|---|
| `feat` | minor |
| `fix`, `hotfix`, `perf` | patch |
| `!` in the title, or a `BREAKING CHANGE:` footer | major |
| `docs`, `chore`, `ci`, `test`, `refactor`, `style` | nothing is published |

Two consequences worth having in mind:

- **The prefix on your branch decides the version.** Name it for what the change actually is: a
  `chore/` branch carrying a feature releases nothing, and a `feat/` branch carrying a typo fix
  bumps a minor for nobody. The type is read from the branch **and** from the PR title, and the
  stronger wins — a `fix/` branch whose title says `feat:` still gets its minor.
- **After the bot pushes, your branch is behind.** Pull before you keep working on it.

To pick the number yourself, write it into `package.json` and `src/static/manifest.json` in the PR:
anything at or above what the automation would have chosen is left alone. To publish a tag that was
never merged, push it (`git push --tags`) or run the release workflow from the Actions tab with the
tag as its input.
