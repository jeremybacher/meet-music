/**
 * Orquestador. Mantiene la pestaña de YouTube que hace de reproductor y hace de relé entre ella y
 * el panel de Meet — tanto para los comandos como para la señalización WebRTC.
 *
 * No usa chrome.tabCapture: esa API sólo puede apuntar a pestañas donde el usuario haya invocado la
 * extensión (clic en el ícono, atajo, menú contextual), y una pestaña de fondo nunca cumple eso.
 * El audio sale de captureStream() sobre el <video> de YouTube y viaja por WebRTC.
 */
import {
  PORT_MEET,
  PORT_PLAYER,
  type PanelReq,
  type PlayerCmd,
  type PlayerEvent,
  type PlayerState,
  type SwEvent,
} from '../core/messages.js'
import { describeVideo } from '../youtube/oembed.js'

const PLAYER_READY_TIMEOUT_MS = 20_000
const watchUrl = (videoId: string): string => `https://www.youtube.com/watch?v=${videoId}`

let playerPort: chrome.runtime.Port | null = null
let playerTabId: number | null = null
let lastPlayerState: PlayerState | null = null

/** Un panel por pestaña de Meet. */
const meetPorts = new Map<number, chrome.runtime.Port>()
/** Qué pestaña de Meet es el DJ: es la única que recibe la señalización. */
let owningMeetTabId: number | null = null
/** Abrimos YouTube en primer plano para destrabar el autoplay; el foco vuelve solo al sonar. */
let pendingFocusReturn = false

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === PORT_PLAYER) return attachPlayer(port)
  if (port.name === PORT_MEET) return attachMeet(port)
})

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === playerTabId) {
    playerTabId = null
    playerPort = null
    lastPlayerState = null
    broadcast({ type: 'player-gone' })
  }
  meetPorts.delete(tabId)
})

// ---------------------------------------------------------------- pestaña de YouTube

function attachPlayer(port: chrome.runtime.Port): void {
  playerPort = port
  playerTabId = port.sender?.tab?.id ?? null

  port.onMessage.addListener((raw) => {
    const event = raw as PlayerEvent
    switch (event.type) {
      case 'ready':
        break
      case 'signal':
        toOwner({ type: 'signal', signal: event.signal })
        break
      case 'state':
        lastPlayerState = event.state
        broadcast({ type: 'player-state', state: event.state })
        break
      case 'capture-failed':
        toOwner({ type: 'capture-failed', error: event.error })
        break
      case 'needs-gesture':
        toOwner({ type: 'needs-gesture' })
        break
      case 'gesture-granted':
        // Ya está sonando de verdad: devolvemos el foco al Meet, pero sólo si fuimos nosotros
        // quienes trajimos al usuario hasta acá.
        if (pendingFocusReturn) {
          pendingFocusReturn = false
          void returnFocusToMeet()
        }
        break
    }
  })

  port.onDisconnect.addListener(() => {
    if (playerPort === port) {
      playerPort = null
      lastPlayerState = null
    }
  })
}

const toPlayer = (cmd: PlayerCmd): void => {
  try {
    playerPort?.postMessage(cmd)
  } catch {
    playerPort = null
  }
}

/**
 * Deja la pestaña de YouTube reproduciendo este video.
 *
 * Si ya está viva, cambia de canción **dentro del mismo documento** (`loadVideoById`): así no se
 * corta el audio, no hay que repactar WebRTC y —clave— no se pierde el permiso de autoplay.
 *
 * Sólo al crearla se navega, y en ese caso se abre **en primer plano**: Chrome no deja arrancar
 * audio en una pestaña que nunca estuvo visible. En cuanto suena, `gesture-granted` devuelve el
 * foco al Meet automáticamente.
 */
async function ensurePlayerTab(videoId: string): Promise<'created' | 'reused'> {
  if (playerTabId !== null) {
    try {
      await chrome.tabs.get(playerTabId)
    } catch {
      playerTabId = null
      playerPort = null
    }
  }

  if (playerTabId !== null && playerPort) {
    toPlayer({ type: 'load', videoId })
    return 'reused'
  }

  if (playerTabId === null) {
    const tab = await chrome.tabs.create({ url: watchUrl(videoId), pinned: true, active: true })
    playerTabId = tab.id ?? null
  } else {
    playerPort = null
    await chrome.tabs.update(playerTabId, { url: watchUrl(videoId), active: true })
  }

  if (playerTabId === null) throw new Error('Could not open the YouTube tab')
  pendingFocusReturn = true

  // A propósito NO se silencia la pestaña. Con Web Audio el elemento ya no manda nada a los
  // parlantes (su salida va al grafo), así que el mute no haría falta; y con el plan B por
  // captureStream, silenciar la pestaña puede dejar la captura muda.
  await waitForPlayerPort()
  return 'created'
}

const waitForPlayerPort = (): Promise<void> =>
  new Promise((resolve, reject) => {
    if (playerPort) return resolve()
    const started = Date.now()
    const poll = setInterval(() => {
      if (playerPort) {
        clearInterval(poll)
        resolve()
      } else if (Date.now() - started > PLAYER_READY_TIMEOUT_MS) {
        clearInterval(poll)
        reject(new Error('The YouTube tab did not respond in time'))
      }
    }, 100)
  })

async function returnFocusToMeet(): Promise<void> {
  if (owningMeetTabId === null) return
  try {
    const tab = await chrome.tabs.get(owningMeetTabId)
    await chrome.tabs.update(owningMeetTabId, { active: true })
    if (tab.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true })
  } catch {
    // La pestaña de Meet ya no está.
  }
}

// ---------------------------------------------------------------- panel de Meet

function attachMeet(port: chrome.runtime.Port): void {
  const tabId = port.sender?.tab?.id
  if (tabId === undefined) return
  meetPorts.set(tabId, port)

  if (lastPlayerState) port.postMessage({ type: 'player-state', state: lastPlayerState } satisfies SwEvent)

  port.onMessage.addListener((raw) => {
    void handlePanelReq(raw as PanelReq, tabId, port)
  })

  port.onDisconnect.addListener(() => {
    if (meetPorts.get(tabId) === port) meetPorts.delete(tabId)
  })
}

async function handlePanelReq(req: PanelReq, tabId: number, port: chrome.runtime.Port): Promise<void> {
  const send = (event: SwEvent): void => port.postMessage(event)

  try {
    switch (req.type) {
      case 'start-audio':
        owningMeetTabId = tabId
        await ensurePlayerTab(req.videoId)
        // El lado de Meet siempre necesita un enlace nuevo, se haya creado la pestaña o no.
        toPlayer({ type: 'connect' })
        break

      case 'signal':
        toPlayer({ type: 'signal', signal: req.signal })
        break

      case 'stop-audio':
        toPlayer({ type: 'pause' })
        send({ type: 'audio-stopped' })
        break

      case 'load': {
        owningMeetTabId = tabId
        const mode = await ensurePlayerTab(req.videoId)
        // Reusando el documento, el enlace de audio sigue vivo: no hay que repactar nada.
        if (mode === 'created') toPlayer({ type: 'connect' })
        break
      }

      case 'play':
        toPlayer({ type: 'play' })
        break

      case 'pause':
        toPlayer({ type: 'pause' })
        break

      case 'seek':
        toPlayer({ type: 'seek', seconds: req.seconds })
        break

      case 'monitor':
        toPlayer({ type: 'monitor', level: req.level })
        break

      case 'focus-player': {
        owningMeetTabId = tabId
        if (playerTabId !== null) {
          const tab = await chrome.tabs.get(playerTabId)
          await chrome.tabs.update(playerTabId, { active: true })
          if (tab.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true })
        }
        break
      }

      case 'open-options':
        await chrome.runtime.openOptionsPage()
        break

      case 'resolve':
        send({ type: 'resolved', track: await describeVideo(req.videoId) })
        break
    }
  } catch (err) {
    send({ type: 'error', error: describe(err), fatal: req.type === 'start-audio' })
  }
}

/** La señalización es punto a punto: sólo le llega al panel que está haciendo de DJ. */
const toOwner = (event: SwEvent): void => {
  if (owningMeetTabId === null) return
  meetPorts.get(owningMeetTabId)?.postMessage(event)
}

const broadcast = (event: SwEvent): void => {
  for (const port of meetPorts.values()) port.postMessage(event)
}

const describe = (err: unknown): string => (err instanceof Error ? err.message : String(err))
