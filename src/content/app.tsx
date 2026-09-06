/**
 * Panel de Meet Music. Sólo pinta: toda la lógica vive en Session.
 *
 * El orden de la pantalla es la decisión de diseño principal. De arriba a abajo: lo que salió mal,
 * lo que está sonando, la acción principal, cómo agregar, qué sigue, y recién al final las
 * perillas. Lo que una persona hace más seguido queda más arriba y más cerca del pulgar.
 */
import { useEffect, useRef, useState } from 'preact/hooks'
import { Session, type SessionView } from './session.js'
import type { LinkProblem } from '../youtube/parse-url.js'
import { formatDuration } from '../youtube/parse-url.js'
import type { Track } from '../core/protocol.js'
import type { ThemePref } from '../core/theme.js'
import { isCallUrl, watchCallState } from './meet-url.js'
import type { MicButtonBox } from './meet-controls.js'

const BRAND = 'Meet Music'

/**
 * Va en el panel y en la página de opciones, con el mismo texto en los dos lados. El panel se
 * dibuja adentro de Meet y se parece a Meet a propósito, que es justo lo que obliga a decirlo:
 * quien lo ve por primera vez no tiene por qué saber que no es una función de Google.
 */
const UNAFFILIATED =
  'An independent project, not affiliated with or endorsed by Google. Google Meet and YouTube are trademarks of Google LLC.'

export function App() {
  const [inCall, setInCall] = useState(() => isCallUrl(location.href))
  const [session, setSession] = useState<Session | null>(null)
  const [view, setView] = useState<SessionView | null>(null)
  const [open, setOpen] = useState(false)
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

  /**
   * Escape cierra el panel. Se captura antes que Meet y se corta la propagación **sólo** si el
   * panel está abierto: con el panel cerrado, Escape sigue siendo de Meet y no tenemos derecho a
   * quedárnoslo.
   */
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      if (showSettings) setShowSettings(false)
      else setOpen(false)
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [open, showSettings])

  // Con esto TypeScript sabe que `session` existe en todo el resto del componente.
  if (!inCall || !session || !view) return null

  const live = view.audio === 'on'
  const remote = view.hostName !== null && !view.isHost

  /**
   * Ocupamos el lugar del botón de micrófono de Meet, pero sólo mientras apretarlo cortaría la
   * música. Si estás silenciado en Meet, el botón que necesitás es el de Meet —es el único que te
   * devuelve el micrófono— así que le dejamos su lugar y el nuestro vuelve al dock.
   */
  const overlay = live && !view.micMuted ? view.micButton : null

  return (
    <div class="root" data-theme={view.theme}>
      {overlay && <MuteVoiceButton view={view} session={session} box={overlay} />}

      <div class="dock">
        {/* Sin música, mutear la voz es cosa del botón de Meet y un segundo botón sería una
            mentira. Con música pero sin poder tapar el de Meet, éste es el único que hace lo
            correcto: mejor acá que en ningún lado. */}
        {live && !overlay && <MuteVoiceButton view={view} session={session} />}

        <button
          class="launcher"
          data-active={String(live)}
          title={launcherTitle(view)}
          aria-label={launcherTitle(view)}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <Icon path={NOTE} standalone />
          {/* Verde: sale de acá. Azul: suena en la reunión, la pone otra persona. */}
          {(live || remote) && <span class="dot" data-tone={live ? 'live' : 'remote'} />}
        </button>
      </div>

      {open && (
        <div class="panel" role="dialog" aria-label={BRAND} aria-modal="false">
          <header>
            {showSettings && (
              <button
                class="icon-btn"
                title="Back"
                aria-label="Back to the player"
                onClick={() => setShowSettings(false)}
              >
                ←
              </button>
            )}
            <h2>{showSettings ? 'Settings' : BRAND}</h2>
            {!showSettings && <StatusBadge view={view} />}
            {!showSettings && (
              <button
                class="icon-btn"
                title="Settings"
                aria-label="Settings"
                onClick={() => setShowSettings(true)}
              >
                ⚙
              </button>
            )}
            <button class="icon-btn" title="Close" aria-label="Close the panel" onClick={() => setOpen(false)}>
              ✕
            </button>
          </header>

          <div class="body">
            {showSettings ? (
              <Settings view={view} session={session} />
            ) : (
              <Main view={view} session={session} />
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Callarte sin cortar la música.
 *
 * Con `box` se dibuja exactamente encima del botón de micrófono de Meet, copiándole el tamaño y los
 * colores —Meet tiene su propio tema, que no tiene por qué ser el que elegiste para el panel— para
 * que sea *el* botón de micrófono y no uno más al lado. Sin `box` vive en el dock, que es la
 * degradación cuando no se lo encuentra.
 */
function MuteVoiceButton({
  view,
  session,
  box,
}: {
  view: SessionView
  session: Session
  box?: MicButtonBox
}) {
  const muted = view.voiceMuted
  // Silenciado manda el rojo de Meet; taparlo con el color del botón de abajo perdería la señal.
  const skin = muted ? '' : `${box?.bg ? `background:${box.bg};` : ''}${box?.fg ? `color:${box.fg};` : ''}`
  const geometry = box
    ? `top:${box.top}px;left:${box.left}px;width:${box.width}px;height:${box.height}px;${skin}`
    : undefined

  const title = muted
    ? 'Your voice is muted — the music keeps playing for the meeting. Click to speak again.'
    : box
      ? 'Mute your voice — the music keeps playing. While music is on this takes over Meet\u2019s mic button, which would cut the music too.'
      : 'Mute your voice without cutting the music'

  return (
    <button
      class="launcher"
      data-muted={String(muted)}
      data-overlay={box ? 'true' : undefined}
      style={geometry}
      title={title}
      aria-label={muted ? 'Unmute your voice' : 'Mute your voice, keeping the music playing'}
      aria-pressed={muted}
      onClick={() => session.toggleVoice()}
    >
      <Icon path={muted ? MIC_OFF : MIC} standalone />
    </button>
  )
}

/**
 * El cuerpo del panel cuando no estás en ajustes.
 *
 * Todo lo condicional sale de tres preguntas, en este orden: ¿alguien está reproduciendo?, ¿se está
 * conectando?, ¿hay siquiera una canción? De ahí salen los tres guiones posibles —la sala en blanco,
 * la conexión en curso y la música andando— sin que ningún bloque tenga que adivinar el contexto.
 *
 * La sala en blanco es la única que explica algo. Con música puesta la explicación desaparece: ya
 * no dice nada que la pantalla no esté mostrando.
 */
function Main({ view, session }: { view: SessionView; session: Session }) {
  const remote = view.hostName !== null && !view.isHost
  const starting = view.audio === 'starting'
  // `error` cuenta como reproduciendo: la sesión existe, falló la toma de audio, y lo que hace
  // falta es el cartel con su salida — no el botón de arrancar, que ya se apretó.
  const playing =
    !starting && (view.audio === 'on' || view.audio === 'waiting' || view.audio === 'error' || remote)
  const blank = !playing && !starting && !view.state.current

  return (
    <>
      <Banners view={view} session={session} />

      {blank && <Intro />}
      {view.state.current && <NowPlaying view={view} session={session} />}

      {playing ? (
        <Transport view={view} session={session} />
      ) : (
        <StartButton view={view} session={session} />
      )}

      <AddSong view={view} session={session} autoFocus={blank} />
      <Queue view={view} session={session} />
      <Sound view={view} session={session} />
      <Footer view={view} session={session} />
    </>
  )
}

/**
 * Lo único que hay que entender antes de usar esto, dicho una vez y sólo cuando no hay nada
 * sonando. Con música puesta ya no aporta nada y desaparece.
 */
function Intro() {
  return (
    <div class="stage">
      <div class="stage-title">Play music for the whole meeting</div>
      <div class="hint">
        Paste a YouTube link and the audio is mixed into your microphone, so everyone hears it —
        nobody else has to install anything.
      </div>
    </div>
  )
}

/** El botón grande de arrancar, con su motivo cuando está apagado. */
function StartButton({ view, session }: { view: SessionView; session: Session }) {
  const noTrack = !view.state.current
  const starting = view.audio === 'starting'

  return (
    <button
      class="action"
      data-primary="true"
      disabled={starting || noTrack}
      title={noTrack ? 'Add a song first' : 'Opens a YouTube tab and plays it for the meeting'}
      onClick={() => session.startAudio()}
    >
      {starting ? (
        <>
          <span class="spinner" aria-hidden="true" />
          Connecting…
        </>
      ) : (
        <>
          <Icon path={HEADSET} />
          Play music here
        </>
      )}
    </button>
  )
}

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
  const [label, tip, tone] = badgeState(view)
  return (
    <span class="badge" data-tone={tone} title={tip}>
      {label}
    </span>
  )
}

const badgeState = (view: SessionView): [string, string, string | undefined] => {
  if (view.audio === 'waiting') {
    return [
      'Not on air',
      'The music is ready but Meet is not sending your microphone, so nobody hears it yet',
      'warn',
    ]
  }
  if (view.audio === 'on') {
    return view.voiceMuted
      ? ['On air · muted', 'Your voice is muted, but the meeting still hears the music', 'live']
      : ['On air', 'The meeting is hearing the music you play', 'live']
  }
  if (view.hostName !== null) {
    return [
      `DJ: ${view.hostName || BRAND}`,
      `${view.hostName || 'Someone'} is playing the music. You can add songs to their queue.`,
      undefined,
    ]
  }
  return ['No music', 'Nobody is playing music yet', undefined]
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
const ADD = 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z'
/** `campaign`: el aviso en el chat para quien no tiene la extensión. */
const CAMPAIGN =
  'M18 11v2h4v-2h-4zm-2 6.61c.96.71 2.21 1.65 3.2 2.39.4-.53.8-1.07 1.2-1.6-.99-.74-2.24-1.68-3.2-2.4-.4.54-.8 1.08-1.2 1.61zM20.4 5.6c-.4-.53-.8-1.07-1.2-1.6-.99.74-2.24 1.68-3.2 2.4.4.53.8 1.07 1.2 1.6.96-.72 2.21-1.65 3.2-2.4zM4 9c-1.1 0-2 .9-2 2v2c0 1.1.9 2 2 2h1v4h2v-4h1l5 3V6L8 9H4zm11.5 3c0-1.33-.58-2.53-1.5-3.35v6.69c.92-.81 1.5-2.01 1.5-3.34z'

/** El tooltip explica qué es y, si hay algo sonando, qué está sonando. */
const launcherTitle = (view: SessionView): string => {
  if (view.audio === 'on') {
    const track = view.state.current
    return track
      ? `${BRAND} — playing “${track.title}” for the whole meeting`
      : `${BRAND} — audio is connected`
  }
  if (view.audio === 'waiting') {
    return `${BRAND} — ready, but Meet is not sending your microphone yet`
  }
  if (view.hostName !== null) {
    const who = view.hostName || 'Someone'
    return `${BRAND} — ${who} is playing music. Open the panel to add songs.`
  }
  return `${BRAND} — play YouTube music for the whole meeting`
}

/**
 * Todo lo que puede salir mal, cada cosa con su salida.
 *
 * `aria-live` importa más que de costumbre acá: son avisos que aparecen solos, sin que nadie haya
 * apretado nada, y quien usa lector de pantalla no tiene forma de enterarse de otro modo.
 */
function Banners({ view, session }: { view: SessionView; session: Session }) {
  return (
    <div class="banners" role="status" aria-live="polite">
      {/* El fallo de captura y su plan B son un solo problema: un solo cartel, con el botón. */}
      {view.audio === 'error' ? (
        <div class="banner" data-tone="error">
          {view.error ?? 'Could not pick up the YouTube audio.'}
          <div class="hint" style="margin-top:6px">
            You can share the tab by hand instead. Pick the YouTube tab in Chrome's picker and
            <strong> tick “Share tab audio”</strong>.
          </div>
          <div class="controls" style="margin-top:10px">
            <button class="action" data-primary="true" onClick={() => session.startAudio()}>
              Try again
            </button>
            <button class="action" onClick={() => session.captureDisplay()}>
              Share the tab by hand
            </button>
          </div>
        </div>
      ) : (
        view.error && (
          <div class="banner" data-tone="error">
            {view.error}
          </div>
        )
      )}

      {view.audio === 'waiting' && (
        <div class="banner" data-tone="warn">
          <strong>The meeting is not hearing this yet.</strong> Meet is not sending your microphone,
          so the music has nowhere to ride. Turn your mic on in Meet and it comes in on its own — no
          need to start over.
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

      {view.micMuted && view.audio === 'on' && (
        <div class="banner" data-tone="warn">
          <strong>Your mic is muted in Meet, so nobody hears the music either.</strong> It rides on
          your microphone track, so Meet's mute cuts both. Unmute there — while music is playing,
          that button becomes {BRAND}'s and silences only your voice.
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

      {view.shareQueue && !view.canBroadcast && !view.chatNeedsDecision && (
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
    </div>
  )
}

function NowPlaying({ view, session }: { view: SessionView; session: Session }) {
  const track = view.state.current
  if (!track) return null

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
          <div class="now-title" title={track.title}>
            {track.title}
          </div>
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
        aria-label={seekable ? 'Jump to a point in the song' : 'Progress'}
        title={seekable ? 'Click to jump to that point' : 'Only whoever is playing can jump around'}
        onClick={seek}
      >
        <span class="track">
          <span class="fill" style={`width:${pct}%`} />
        </span>
      </button>
    </div>
  )
}

/** Play/pausa y siguiente. Cuando reproduce otra persona, son pedidos para toda la reunión. */
function Transport({ view, session }: { view: SessionView; session: Session }) {
  const remote = view.hostName !== null && !view.isHost
  const nothing = !view.state.current

  return (
    <div class="controls">
      <button
        class="action"
        data-primary="true"
        disabled={nothing}
        title={
          nothing
            ? 'Nothing is playing'
            : remote
              ? `${view.state.playing ? 'Pauses' : 'Resumes'} for the whole meeting`
              : undefined
        }
        onClick={() => session.setPlaying(!view.state.playing)}
      >
        <Icon path={view.state.playing ? PAUSE : PLAY} />
        {view.state.playing ? 'Pause' : 'Play'}
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
  )
}

/**
 * El campo para sumar canciones.
 *
 * Vive alto en la pantalla a propósito: es lo que más se usa. El botón queda deshabilitado mientras
 * el campo está vacío y muestra su progreso mientras se busca el título, porque pegar un link y no
 * ver absolutamente nada durante un segundo se lee como que la extensión no funciona.
 */
function AddSong({
  view,
  session,
  autoFocus,
}: {
  view: SessionView
  session: Session
  autoFocus?: boolean
}) {
  const [input, setInput] = useState('')
  const [problem, setProblem] = useState<LinkProblem | null>(null)
  const field = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (autoFocus) field.current?.focus()
  }, [autoFocus])

  const submit = (e: Event) => {
    e.preventDefault()
    const result = session.submit(input)
    // El campo se vacía sólo si el link se entendió: si no, queda tal cual para poder corregirlo,
    // marcado y con el motivo debajo.
    if (result.ok) {
      setInput('')
      setProblem(null)
    } else {
      setProblem(result.problem)
    }
    field.current?.focus()
  }

  const remote = view.hostName !== null && !view.isHost
  const empty = input.trim().length === 0
  const invalid = problem !== null

  return (
    <form class="add" onSubmit={submit} noValidate>
      <div class="row">
        <input
          ref={field}
          type="text"
          aria-label="YouTube video link"
          aria-invalid={invalid}
          aria-describedby={invalid ? 'mm-link-error' : undefined}
          data-invalid={String(invalid)}
          placeholder={remote ? 'Add a song to the queue' : 'Paste a YouTube video link'}
          value={input}
          // El error se va al primer cambio: seguir marcando en rojo lo que ya se está corrigiendo
          // es discutirle a alguien que ya te dio la razón.
          onInput={(e) => {
            setInput((e.target as HTMLInputElement).value)
            if (problem) setProblem(null)
          }}
        />
        <button
          class="action"
          data-primary="true"
          data-icon="true"
          type="submit"
          disabled={empty || view.resolving}
          aria-label="Add to queue"
          title={empty ? 'Paste a YouTube link first' : 'Add to queue'}
        >
          {view.resolving ? <span class="spinner" aria-hidden="true" /> : <Icon path={ADD} standalone />}
        </button>
      </div>

      {problem && (
        <div class="field-error" id="mm-link-error" role="alert">
          {linkProblemText(problem)}
        </div>
      )}
    </form>
  )
}

/**
 * Qué decirle a quien pegó algo que no sirve.
 *
 * Un "link inválido" genérico deja a la persona exactamente donde estaba. Cada caso tiene un
 * siguiente paso distinto, y decirlo es la diferencia entre un error y una ayuda.
 */
const linkProblemText = (problem: LinkProblem): string => {
  switch (problem.reason) {
    case 'no-video':
      return 'That is a YouTube link, but not to a video. Playlists, channels and search results do not work yet — open the video itself and copy the address from there.'
    case 'other-service':
      return `${BRAND} can only play YouTube. Look the song up on YouTube and paste that link instead of the ${problem.service} one.`
    default:
      return 'That does not look like a YouTube link. Copy a video address from YouTube — it looks like youtube.com/watch?v=… or youtu.be/…'
  }
}

/**
 * Las perillas. Son independientes a propósito: mover la música nunca toca la voz, y el monitor
 * local nunca cambia lo que escucha la reunión.
 *
 * Quien no está reproduciendo ve un stepper, no sliders: no puede regular la música sólo para sí
 * —le llega fusionada con la voz de quien la pone— así que cada toque es un pedido para todos.
 */
function Sound({ view, session }: { view: SessionView; session: Session }) {
  const onAir = view.audio === 'on' || view.audio === 'waiting'
  const remote = !onAir && view.hostName !== null && !view.isHost

  if (remote) {
    return (
      <div class="group">
        <div class="section-title">Music volume · for everyone</div>
        <VolumeStepper level={view.state.volume} onChange={(v) => session.setSharedVolume(v)} />
        <div class="hint">
          {view.hostName || 'Whoever is playing'} has the music mixed into their microphone, so it
          reaches you fused with their voice — it cannot be turned down just for you. These buttons
          change it for the whole meeting.
        </div>
      </div>
    )
  }

  if (!onAir) return null

  return (
    <div class="group">
      <div class="section-title">Sound</div>

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

      <label class="toggle">
        <input
          type="checkbox"
          checked={view.duck.enabled}
          onChange={(e) => session.setDuck({ enabled: (e.target as HTMLInputElement).checked })}
        />
        Lower the music automatically while I talk
      </label>

      <div class="hint">
        Moving the music never changes how loud your voice is: they run through separate branches of
        the mixer. Headphones are worth it — through speakers the music leaks back into your mic and
        the meeting hears it twice, slightly out of sync.
      </div>

      <AudioDiagnostics view={view} />
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

  const detail = `Audio source: ${player.source === 'webaudio' ? 'Web Audio' : 'captureStream (fallback)'} · senders carrying the mix: ${view.outgoing}`

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
 * El pie: en qué anda el canal compartido, y la salida.
 *
 * Va abajo porque es lo que menos se toca, y porque "parar" es destructivo para toda la reunión:
 * no tiene por qué estar al alcance del pulgar.
 */
function Footer({ view, session }: { view: SessionView; session: Session }) {
  const playing = view.audio !== 'off' || view.hostName !== null

  return (
    <div class="footer">
      <ChannelStatus view={view} />

      {view.audio === 'on' && view.announce && (
        <button
          class="action"
          data-quiet="true"
          title="Writes one readable line in the Meet chat: what is playing and where to get Meet Music"
          onClick={() => session.announceNow()}
        >
          <Icon path={CAMPAIGN} />
          Tell the meeting what is playing
        </button>
      )}

      {playing && (
        <button
          class="action"
          data-quiet="true"
          title="Stops the music, clears the queue and frees the spot — for the whole meeting"
          onClick={() => session.stopAudio()}
        >
          Stop and clear queue
        </button>
      )}
    </div>
  )
}

/**
 * Qué sabe la extensión del resto de la reunión.
 *
 * Sin esto, entrar a una reunión donde ya suena música se ve idéntico a entrar a una vacía, y no
 * hay forma de distinguir "nadie puso nada" de "el canal no está funcionando".
 */
function ChannelStatus({ view }: { view: SessionView }) {
  if (!view.shareQueue) {
    return (
      <div class="hint">
        Queue sharing is off, so this queue is only yours and nobody else can add to it.
      </div>
    )
  }

  const { chat, participants } = view
  const detail =
    `chat ${chat.chatOpen ? 'open' : 'closed'} · send button ${chat.sendButton ? 'found' : 'missing'}` +
    ` · sent ${chat.sent} · received ${chat.received} · pending ${chat.pending}` +
    ` · participants ${participants.count ?? '?'} (${participants.source ?? 'unreadable'})` +
    ` · announced ${view.announced}`

  if (!chat.chatOpen) {
    return (
      <div class="hint" data-tone="warn" title={detail}>
        The Meet chat is closed, so the shared queue cannot travel. It should reopen on its own in a
        moment.
      </div>
    )
  }

  if (view.hostName !== null && !view.isHost) {
    return (
      <div class="hint" title={detail}>
        {view.hostName || 'Someone'} is playing. Anything you add goes into their queue.
      </div>
    )
  }

  if (chat.sent === 0 && chat.received === 0) {
    return (
      <div class="hint" title={detail}>
        Sharing with the meeting · nothing heard back yet. Others only see the queue if they have
        this extension too.
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
      <span class="level" aria-live="polite">
        {Math.round(level * 100)}%
      </span>
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
        aria-label={label}
        value={String(Math.round(value * 100))}
        onInput={(e) => onChange(Number((e.target as HTMLInputElement).value) / 100)}
      />
    </div>
  )
}

function Queue({ view, session }: { view: SessionView; session: Session }) {
  const queue: Track[] = view.state.queue
  if (queue.length === 0) return null

  return (
    <div>
      <div class="section-title">Up next ({queue.length}) · anyone can add, reorder or skip</div>
      <ul>
        {queue.map((t) => (
          <li key={t.id}>
            {t.thumb && <img src={t.thumb} alt="" />}
            <span class="title" title={t.title}>
              {t.title}
              <Attribution addedBy={t.addedBy} />
            </span>
            <span class="dur">{formatDuration(t.duration)}</span>
            <button
              class="icon-btn"
              title={`Play “${t.title}” now — for the whole meeting`}
              aria-label={`Play ${t.title} now`}
              onClick={() => session.jump(t.id)}
            >
              <Icon path={PLAY} standalone />
            </button>
            <button
              class="icon-btn"
              title={`Remove “${t.title}” from the queue`}
              aria-label={`Remove ${t.title} from the queue`}
              onClick={() => session.remove(t.id)}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * Si el aviso automático está funcionando, y si no, por qué.
 *
 * Detectar que entró alguien depende de leer el contador de participantes del DOM de Meet, que no
 * es una API y cambia sin avisar. Sin decir esto en algún lado, "no avisó" y "no encuentro el
 * contador" se ven idénticos desde afuera — y el arreglo de cada uno es distinto.
 */
function AnnounceStatus({ view }: { view: SessionView }) {
  const { count, source } = view.participants
  const sent = view.announced === 1 ? '1 posted so far' : `${view.announced} posted so far`

  if (count === null) {
    return (
      <div class="hint" data-tone="warn">
        Right now the extension <strong>cannot tell how many people are in the call</strong>, so it
        will not notice anyone joining — Meet's layout must have changed. Everything else keeps
        working, and <em>Tell the meeting what is playing</em> at the bottom of the player posts the
        line whenever you want.
      </div>
    )
  }

  return (
    <div class="hint" title={`participants: ${count} · source: ${source}`}>
      Reading {count} {count === 1 ? 'person' : 'people'} in the call, so joins are noticed · {sent}.
    </div>
  )
}

function Settings({ view, session }: { view: SessionView; session: Session }) {
  // El campo se maneja localmente: atado a `view.displayName` cualquier repintado lo devolvía al
  // valor guardado y borraba lo tipeado. La sesión se entera al soltar el foco.
  const [name, setName] = useState(view.displayName)
  const version = chrome.runtime.getManifest().version

  return (
    <div class="settings">
      <div class="section-title">Your name</div>
      <div class="row">
        <input
          type="text"
          aria-label="Your display name"
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
          aria-label="Panel theme"
          value={view.themePref}
          onChange={(e) => session.setTheme((e.target as HTMLSelectElement).value as ThemePref)}
        >
          <option value="system">Follow the browser</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </div>

      <div class="section-title">The Meet chat</div>

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
            It never overwrites a message you're typing.{' '}
            <strong>The Meet chat panel is kept open</strong> while this is on — closed, Meet does
            not render incoming messages, so you would stop seeing what others add. Off, the queue
            is yours alone and you can close the chat.
          </span>
        </span>
      </label>

      <label class="toggle">
        <input
          type="checkbox"
          checked={view.announce}
          onChange={(e) => session.setAnnounce((e.target as HTMLInputElement).checked)}
        />
        <span>
          Tell the meeting what is playing
          <span class="hint" style="display:block">
            When someone joins while you are playing, the extension posts <strong>one readable
            line</strong> in the chat: the song, that you are sharing it, and where to get{' '}
            {BRAND}. It is the only message meant for people who do not have the extension —
            without it, walking into music with no visible source is just confusing. Meet's chat
            hides everything sent before you arrived, so each arrival needs its own line; several
            people arriving together share one, and there is never more than one every 30 seconds.
          </span>
        </span>
      </label>

      {view.announce && <AnnounceStatus view={view} />}

      <div class="about">
        {BRAND} {version} ·{' '}
        <a href="https://github.com/jeremybacher/meet-music" target="_blank" rel="noreferrer">
          How it works
        </a>{' '}
        ·{' '}
        <a
          href="https://github.com/jeremybacher/meet-music/blob/main/LICENSE"
          target="_blank"
          rel="noreferrer"
        >
          MIT licence
        </a>
        <span class="disclaimer">{UNAFFILIATED}</span>
      </div>
    </div>
  )
}
