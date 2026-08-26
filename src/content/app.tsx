/** Panel de Meet Music. Sólo pinta: toda la lógica vive en Session. */
import { useEffect, useState } from 'preact/hooks'
import { Session, type SessionView } from './session.js'
import { formatDuration } from '../youtube/parse-url.js'
import type { Track } from '../core/protocol.js'
import type { ThemePref } from '../core/theme.js'
import { isCallUrl, watchCallState } from './meet-url.js'

export function App() {
  const [inCall, setInCall] = useState(() => isCallUrl(location.href))
  const [session, setSession] = useState<Session | null>(null)
  const [view, setView] = useState<SessionView | null>(null)
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [showSettings, setShowSettings] = useState(false)

  // Meet es una SPA: se entra y se sale de la llamada sin recargar.
  useEffect(() => watchCallState(setInCall), [])

  // La sesión se crea recién al entrar a una llamada, y sobrevive por si se sale y se vuelve:
  // en la home de Meet no hay nada que observar ni a qué conectarse.
  useEffect(() => {
    if (!inCall || session) return
    const created = new Session()
    void created.start()
    setSession(created)
  }, [inCall, session])

  useEffect(() => (session ? session.subscribe(setView) : undefined), [session])

  // Con esto TypeScript sabe que `session` existe en todo el resto del componente.
  if (!inCall || !session || !view) return null

  const live = view.audio === 'on'
  const submit = (e: Event) => {
    e.preventDefault()
    void session.submit(input)
    setInput('')
  }

  return (
    <div class="root" data-theme={view.theme}>
      <div class="dock">
        {/* Sólo aparece con música puesta: sin ella, mutear la voz es cosa del botón de Meet. */}
        {live && (
          <button
            class="launcher"
            data-muted={String(view.voiceMuted)}
            title={
              view.voiceMuted
                ? 'Your voice is muted — the music keeps playing for the meeting'
                : 'Mute your voice without cutting the music'
            }
            aria-label={view.voiceMuted ? 'Unmute your voice' : 'Mute your voice'}
            aria-pressed={view.voiceMuted}
            onClick={() => session.toggleVoice()}
          >
            <Icon path={view.voiceMuted ? MIC_OFF : MIC} standalone />
          </button>
        )}

        <button
          class="launcher"
          data-active={String(live)}
          title={launcherTitle(view)}
          aria-label={launcherTitle(view)}
          aria-pressed={open}
          onClick={() => setOpen(!open)}
        >
          <Icon path={NOTE} standalone />
          {live && <span class="dot" />}
        </button>
      </div>

      {open && (
        <div class="panel">
          <header>
            {showSettings && (
              <button class="icon-btn" title="Back" onClick={() => setShowSettings(false)}>
                ←
              </button>
            )}
            <h2>{showSettings ? 'Settings' : 'Meet Music'}</h2>
            {!showSettings && <StatusBadge view={view} />}
            {!showSettings && (
              <button class="icon-btn" title="Settings" onClick={() => setShowSettings(true)}>
                ⚙
              </button>
            )}
            <button class="icon-btn" title="Close" onClick={() => setOpen(false)}>
              ✕
            </button>
          </header>

          <div class="body">
            {showSettings ? (
              <Settings view={view} session={session!} />
            ) : (
              <>
            <Banners view={view} session={session!} />

            <NowPlaying view={view} session={session} />

            <QueueStatus view={view} />

            <div class="controls">
                <button
                  class="action"
                  disabled={!view.state.current || (view.audio !== 'on' && view.hostName === null)}
                  title={
                    view.hostName !== null && !view.isHost
                      ? 'Pauses for the whole meeting'
                      : undefined
                  }
                  onClick={() => session.setPlaying(!view.state.playing)}
                >
                  {view.state.playing ? (
                    <>
                      <Icon path={PAUSE} />
                      Pause
                    </>
                  ) : (
                    <>
                      <Icon path={PLAY} />
                      Play
                    </>
                  )}
                </button>
                <button
                  class="action"
                  disabled={view.state.queue.length === 0}
                  title={
                    view.state.queue.length === 0
                      ? 'Nothing is waiting in the queue'
                      : `Up next: ${view.state.queue[0].title}`
                  }
                  onClick={() => session.skip()}
                >
                  <Icon path={SKIP} />
                  Next
                </button>
            </div>

            <AudioSection view={view} session={session!} />

            <form class="row" onSubmit={submit}>
              <input
                type="text"
                placeholder="Paste a YouTube video link"
                value={input}
                onInput={(e) => setInput((e.target as HTMLInputElement).value)}
              />
              <button
                class="action"
                data-primary="true"
                style="flex:none;padding:10px 18px"
                type="submit"
                title="Add to queue"
              >
                +
              </button>
            </form>

            <Queue view={view} session={session!} />
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

const BRAND = 'Meet Music'

/**
 * Quién agregó la canción, con la marca adelante.
 *
 * Se muestra siempre, también en las tuyas: la gracia es que todos los participantes vean
 * exactamente lo mismo en su panel, sin que dependa de quién esté mirando.
 */
function Attribution({ addedBy }: { addedBy?: string }) {
  return (
    <span class="by">
      {' · '}
      {BRAND}
      {addedBy ? ` · ${addedBy}` : ''}
    </span>
  )
}

/**
 * Chapita de estado. Responde "¿de quién sale la música que suena en esta reunión?", que es lo
 * único ambiguo cuando varios tienen la extensión.
 */
function StatusBadge({ view }: { view: SessionView }) {
  const [label, tip] =
    view.audio === 'on'
      ? view.voiceMuted
        ? ['On air · muted', 'Your voice is muted, but the meeting still hears the music']
        : ['On air', 'The meeting is hearing the music you play']
      : view.hostName !== null
        ? [
            `DJ: ${view.hostName || BRAND}`,
            `${view.hostName || 'Someone'} is playing the music. You can add songs to their queue.`,
          ]
        : ['No music', 'Nobody is playing music yet']

  return (
    <span class="badge" data-tone={view.audio === 'on' ? 'live' : undefined} title={tip}>
      {label}
    </span>
  )
}

/** Iconos al estilo Material Symbols, el mismo lenguaje visual que los controles de Meet. */
const Icon = ({ path, standalone }: { path: string; standalone?: boolean }) =>
  standalone ? (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={path} />
    </svg>
  ) : (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      width="18"
      height="18"
      style="fill:currentColor;vertical-align:-4px;margin-right:6px"
    >
      <path d={path} />
    </svg>
  )

/** El mismo `music_note` que el ícono de la extensión, para que se reconozcan como lo mismo. */
const NOTE = 'M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z'
const MIC =
  'M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5-3c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z'
const MIC_OFF =
  'M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9l4.19 4.19L21 19.73 4.27 3z'
const VOL_DOWN =
  'M18.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM5 9v6h4l5 5V4L9 9H5z'
const VOL_UP =
  'M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z'
const PLAY = 'M8 5v14l11-7z'
const PAUSE = 'M6 19h4V5H6v14zm8-14v14h4V5h-4z'
const SKIP = 'M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z'
const HEADSET =
  'M12 1c-4.97 0-9 4.03-9 9v7c0 1.66 1.34 3 3 3h3v-8H5v-2c0-3.87 3.13-7 7-7s7 3.13 7 7v2h-4v8h3c1.66 0 3-1.34 3-3v-7c0-4.97-4.03-9-9-9z'

/** El tooltip explica qué es y, si hay algo sonando, qué está sonando. */
const launcherTitle = (view: SessionView): string => {
  if (view.audio === 'on') {
    const track = view.state.current
    return track
      ? `Meet Music — playing “${track.title}” for the whole meeting`
      : 'Meet Music — audio is connected'
  }
  if (view.hostName !== null) {
    const who = view.hostName || 'Someone'
    return `Meet Music — ${who} is playing music. Open the panel to add songs.`
  }
  return 'Meet Music — play YouTube music for the whole meeting'
}

function Banners({ view, session }: { view: SessionView; session: Session }) {
  return (
    <>
      {view.error && (
        <div class="banner" data-tone="error">
          {view.error}
        </div>
      )}

      {view.needsGesture && (
        <div class="banner" data-tone="warn">
          Chrome blocked autoplay in the YouTube tab. One click there is enough, and you come
          right back.
          <button class="action" onClick={() => session.focusPlayer()}>
            Go activate it
          </button>
        </div>
      )}

      {view.audio === 'error' && (
        <div class="banner" data-tone="warn">
          Fallback: share the YouTube tab by hand. Pick it in Chrome's picker and
          <strong> tick “Share tab audio”</strong>.
          <button class="action" onClick={() => session.captureDisplay()}>
            Share the tab by hand
          </button>
        </div>
      )}

      {view.micMuted && view.audio === 'on' && (
        <div class="banner" data-tone="warn">
          Your mic is muted in Meet. The music rides on your microphone track, so while you're
          muted nobody hears it. Unmute in Meet and use <strong>Mute my voice</strong> here instead —
          that one silences you and keeps the music going.
        </div>
      )}

      {view.chatNeedsDecision && (
        <div class="banner" data-tone="warn">
          <strong>The Meet chat needs to stay open.</strong> It is the only shared channel between
          participants, so the queue travels through it — and with the panel closed Meet does not
          even render incoming messages, so you would stop seeing what others add. You closed it a
          few times, so we stopped reopening it. Your call:
          <div class="controls" style="margin-top:10px">
            <button class="action" data-primary="true" onClick={() => session.keepChatOpen()}>
              Keep it open
            </button>
            <button class="action" onClick={() => session.setShareQueue(false)}>
              Stop sharing instead
            </button>
          </div>
        </div>
      )}

      {view.chatStuck && (
        <div class="banner" data-tone="warn">
          The queue is not reaching the chat, so others cannot see what is playing. Open the Meet
          chat and keep it open.
          <button class="action" onClick={() => void session.openChat()}>
            Open chat
          </button>
        </div>
      )}

      {view.shareQueue && !view.canBroadcast && (
        <div class="banner" data-tone="info">
          Sharing the queue needs the Meet chat open.
          <button class="action" onClick={() => void session.openChat()}>
            Open chat
          </button>
        </div>
      )}

      {view.notice && (
        <div class="banner" data-tone="info">
          {view.notice}
        </div>
      )}
    </>
  )
}

function NowPlaying({ view, session }: { view: SessionView; session: Session }) {
  const track = view.state.current
  if (!track) return <div class="empty">Nothing is playing.</div>

  const elapsed = view.player?.currentTime ?? 0
  const total = view.player?.duration || track.duration || 0
  const pct = total > 0 ? Math.min(100, (elapsed / total) * 100) : 0
  const seekable = total > 0 && view.authoritative

  // Se calcula sobre el ancho real de la barra para que el clic caiga donde el usuario apuntó.
  const seek = (e: MouseEvent) => {
    if (!seekable) return
    const el = e.currentTarget as HTMLElement
    const { left, width } = el.getBoundingClientRect()
    if (width <= 0) return
    const ratio = Math.min(1, Math.max(0, (e.clientX - left) / width))
    session.seek(ratio * total)
  }

  return (
    <div>
      <div class="now">
        {track.thumb && <img src={track.thumb} alt="" />}
        <div class="now-meta">
          <div class="now-title">{track.title}</div>
          <div class="now-sub">
            {formatDuration(elapsed)} / {formatDuration(total)}
            <Attribution addedBy={track.addedBy} />
          </div>
        </div>
      </div>
      <button
        class="progress"
        style="margin-top:8px"
        disabled={!seekable}
        title={seekable ? 'Click to jump to that point' : undefined}
        onClick={seek}
      >
        <span class="track">
          <span class="fill" style={`width:${pct}%`} />
        </span>
      </button>
    </div>
  )
}

/**
 * Las tres perillas. Son independientes a propósito: mover la música nunca toca la voz, y el
 * monitor local nunca cambia lo que escucha la reunión.
 */
function AudioSection({ view, session }: { view: SessionView; session: Session }) {
  // Ya reproduce otra persona: ofrecerle arrancar en paralelo sólo lograría dos audios
  // superpuestos. Lo que sí puede hacer es regular lo que ya está sonando.
  if (view.audio !== 'on' && view.hostName !== null && !view.isHost) {
    return (
      <div style="display:grid;gap:10px">
        <div class="section-title">Music volume · for everyone</div>
        <VolumeStepper level={view.state.volume} onChange={(v) => session.setSharedVolume(v)} />
        <div class="hint">
          {view.hostName || 'Whoever is playing'} has the music mixed into their microphone, so it
          reaches you fused with their voice — it cannot be turned down just for you. These buttons
          change it for the whole meeting.
        </div>

        <button
          class="action"
          title="Stops the music, clears the queue and frees the spot — for the whole meeting"
          onClick={() => session.stopAudio()}
        >
          Stop and clear queue
        </button>
      </div>
    )
  }

  if (view.audio !== 'on') {
    const noTrack = !view.state.current
    return (
      <div>
        <button
          class="action"
          data-primary="true"
          disabled={view.audio === 'starting' || noTrack}
          onClick={() => session.startAudio()}
        >
          {view.audio === 'starting' ? (
            'Connecting…'
          ) : (
            <>
              <Icon path={HEADSET} />
              Play music here
            </>
          )}
        </button>
        <div class="hint" style="margin-top:6px">
          {noTrack
            ? 'Paste a video link first — the YouTube tab opens straight to it.'
            : 'A YouTube tab opens and its audio is mixed into your microphone. Everyone else hears it without installing anything.'}
        </div>
      </div>
    )
  }

  return (
    <div style="display:grid;gap:10px">
      <div class="section-title">Volume</div>

      <Slider
        label="Music in the meeting"
        value={view.levels.musicBroadcast}
        ducking={view.ducking}
        onChange={(v) => session.setSharedVolume(v)}
      />
      <Slider
        label="Music just for me"
        value={view.levels.musicMonitor}
        onChange={(v) => session.setLevels({ musicMonitor: v })}
      />
      <Slider label="My voice" value={view.levels.mic} onChange={(v) => session.setLevels({ mic: v })} />

      <button
        class="action"
        data-primary={String(view.voiceMuted)}
        onClick={() => session.toggleVoice()}
      >
        <Icon path={view.voiceMuted ? MIC_OFF : MIC} />
        {view.voiceMuted ? 'Unmute my voice' : 'Mute my voice (music keeps playing)'}
      </button>

      <div class="hint">
        Moving the music never changes how loud your voice is: they run through separate branches of
        the mixer. Headphones are worth it — through speakers the music leaks back into your mic and
        the meeting hears it twice, slightly out of sync.
      </div>

      <AudioDiagnostics view={view} />

      <label class="toggle">
        <input
          type="checkbox"
          checked={view.duck.enabled}
          onChange={(e) => session.setDuck({ enabled: (e.target as HTMLInputElement).checked })}
        />
        Lower the music automatically while I talk
      </label>

      <button
        class="action"
        title="Stops the music, clears the queue and frees the spot — for the whole meeting"
        onClick={() => session.stopAudio()}
      >
        Stop and clear queue
      </button>
    </div>
  )
}

/**
 * Sólo aparece cuando hay algo que decir. Si el audio está saliendo bien, no hay nada que informar
 * y un cartel verde permanente sería ruido.
 *
 * El detalle técnico —de dónde se toma el audio— queda en el tooltip: no le sirve a nadie salvo
 * para reportar un problema.
 */
function AudioDiagnostics({ view }: { view: SessionView }) {
  const player = view.player
  if (!player?.source) return null

  const detail = `Audio source: ${player.source === 'webaudio' ? 'Web Audio' : 'captureStream (fallback)'}`

  if (player.adLikely) {
    return (
      <div class="banner" data-tone="info" title={detail}>
        A YouTube ad is playing. The volume drops on its own until it's over.
      </div>
    )
  }

  if (!player.signal) {
    return (
      <div class="banner" data-tone="warn" title={detail}>
        No audio is reaching the meeting. If it stays this way, try “Share the tab by hand”.
      </div>
    )
  }

  return null
}

/**
 * Qué sabe la extensión del resto de la reunión.
 *
 * Sin esto, entrar a una reunión donde ya suena música se ve idéntico a entrar a una vacía, y no
 * hay forma de distinguir "nadie puso nada" de "el canal no está funcionando".
 */
function QueueStatus({ view }: { view: SessionView }) {
  if (!view.shareQueue) {
    return (
      <div class="hint">
        Queue sharing is off, so this queue is only yours and nobody else can add to it.
      </div>
    )
  }

  const { chat } = view
  const detail = `chat ${chat.chatOpen ? 'open' : 'closed'} · send button ${
    chat.sendButton ? 'found' : 'missing'
  } · sent ${chat.sent} · received ${chat.received} · pending ${chat.pending}`

  if (!chat.chatOpen) {
    return (
      <div class="banner" data-tone="warn" title={detail}>
        The Meet chat is closed, so the shared queue cannot travel. It should reopen on its own in a
        moment.
      </div>
    )
  }

  if (chat.sent === 0 && chat.received === 0) {
    return (
      <div class="banner" data-tone="info" title={detail}>
        Connecting to the meeting queue… If nothing shows up, the others need this extension too.
      </div>
    )
  }

  if (view.hostName !== null && !view.isHost) {
    return (
      <div class="hint" title={detail}>
        {view.hostName || 'Someone'} is playing. Paste a link below and it goes into their queue.
      </div>
    )
  }

  return (
    <div class="hint" title={detail}>
      Sharing with the meeting · {chat.received} updates received
    </div>
  )
}

/**
 * Volumen compartido en pasos, no con slider.
 *
 * Un slider sugiere control fino y personal, y esto no es ninguna de las dos: es un pedido que
 * cambia el volumen para toda la reunión. Con botones cada toque es un pedido explícito, y de paso
 * un arrastre no puede generar una ráfaga de mensajes.
 */
function VolumeStepper({ level, onChange }: { level: number; onChange: (v: number) => void }) {
  const STEP = 0.1
  const step = (delta: number) => onChange(Math.min(1, Math.max(0, Math.round((level + delta) * 10) / 10)))

  return (
    <div class="stepper">
      <button
        class="action"
        disabled={level <= 0}
        title="Turn the music down for everyone"
        aria-label="Turn the music down for everyone"
        onClick={() => step(-STEP)}
      >
        <Icon path={VOL_DOWN} standalone />
      </button>
      <span class="level">{Math.round(level * 100)}%</span>
      <button
        class="action"
        disabled={level >= 1}
        title="Turn the music up for everyone"
        aria-label="Turn the music up for everyone"
        onClick={() => step(STEP)}
      >
        <Icon path={VOL_UP} standalone />
      </button>
    </div>
  )
}

function Slider({
  label,
  value,
  ducking,
  onChange,
}: {
  label: string
  value: number
  ducking?: boolean
  onChange: (v: number) => void
}) {
  return (
    <div class="slider" data-ducking={String(Boolean(ducking))}>
      <div class="slider-head">
        <span>{label}</span>
        <span>{Math.round(value * 100)}%</span>
      </div>
      <input
        type="range"
        min="0"
        max="100"
        value={String(Math.round(value * 100))}
        onInput={(e) => onChange(Number((e.target as HTMLInputElement).value) / 100)}
      />
    </div>
  )
}

function Queue({ view, session }: { view: SessionView; session: Session }) {
  const queue: Track[] = view.state.queue
  return (
    <div>
      <div class="section-title">Queue ({queue.length}) · anyone can add or skip</div>
      {queue.length === 0 ? (
        <div class="empty" style="font-size:12.5px">
          Empty. Paste a YouTube video link above.
        </div>
      ) : (
        <ul>
          {queue.map((t) => (
            <li key={t.id}>
              {t.thumb && <img src={t.thumb} alt="" />}
              <span class="title">
                {t.title}
                <Attribution addedBy={t.addedBy} />
              </span>
              <span class="dur">{formatDuration(t.duration)}</span>
              <button class="icon-btn" title="Remove" onClick={() => session.remove(t.id)}>
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Settings({ view, session }: { view: SessionView; session: Session }) {
  // El campo se maneja localmente: atado a `view.displayName` cualquier repintado lo devolvía al
  // valor guardado y borraba lo tipeado. La sesión se entera al soltar el foco.
  const [name, setName] = useState(view.displayName)

  return (
    <div style="display:grid;gap:14px">
      <div class="section-title">Your name</div>
      <div class="row">
        <input
          type="text"
          placeholder={BRAND}
          value={name}
          onInput={(e) => setName((e.target as HTMLInputElement).value)}
          onBlur={() => session.setDisplayName(name)}
        />
      </div>
      <div class="hint">
        Shown next to every song you add. Leave it empty to appear just as {BRAND}.
      </div>

      <div class="section-title">Theme</div>
      <div class="row">
        <select
          value={view.themePref}
          onChange={(e) => session.setTheme((e.target as HTMLSelectElement).value as ThemePref)}
        >
          <option value="system">Follow the browser</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </div>

      <label class="toggle">
        <input
          type="checkbox"
          checked={view.shareQueue}
          onChange={(e) => session.setShareQueue((e.target as HTMLInputElement).checked)}
        />
        <span>
          Share the queue with the meeting
          <span class="hint" style="display:block">
            For others to add songs there has to be a shared channel, and without a server the
            only one is the Meet chat. With this on, the extension{' '}
            <strong>writes messages there</strong>, encrypted with the meeting code: unreadable from
            outside and hidden for anyone who has the extension, though everyone else sees odd text.
            It never overwrites a message you're typing.
            {' '}
            <strong>The Meet chat panel is kept open</strong> while this is on — closed, Meet does
            not render incoming messages, so you would stop seeing what others add. Off, the queue
            is yours alone and you can close the chat.
          </span>
        </span>
      </label>


    </div>
  )
}
