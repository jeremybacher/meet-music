/**
 * Transporte de la cola compartida sobre el chat de Meet.
 *
 * Sin backend, el chat es el único canal compartido escribible desde un content script. Los
 * mensajes son diminutos y poco frecuentes, así que alcanza de sobra.
 *
 * Van cifrados con la clave de la sala (ver `core/crypto.ts`): son ilegibles para quien no esté en
 * la reunión, y nadie puede escribir a mano algo que la extensión tome por una orden.
 *
 * El DOM de Meet está ofuscado y cambia seguido, así que acá no hay selectores exactos para leer:
 * observamos todo el body y buscamos el prefijo. Para escribir sí hace falta encontrar el campo de
 * texto, y eso puede fallar — por eso `canSend()` existe y el panel cae a modo DJ-only.
 */
import type { Msg } from '../core/protocol.js'
import { WIRE_PREFIX, WIRE_RE, openMsg, sealMsg } from '../core/wire.js'

export interface ChatDiagnostics {
  /** Encontramos el campo de texto, o sea que el panel de chat está abierto. */
  chatOpen: boolean
  /** Encontramos el botón de enviar, que es la vía confiable frente a simular Enter. */
  sendButton: boolean
  sent: number
  received: number
  pending: number
  failures: number
}

/** Cada cuánto reintenta cuando el envío está postergado porque estás escribiendo. */
const RETRY_MS = 1200
/** Cuántos mensajes se acumulan esperando. Más que esto es una sesión anómala. */
const OUTBOX_MAX = 20

/** Mensajes de los que sólo vale el último; encolar los intermedios no aporta nada. */
const LATEST_WINS = new Set<Msg['op']>(['volume', 'playback', 'state'])

/** Tope de payloads recordados para deduplicar. */
const SEEN_MAX = 2000

export class ChatTransport {
  private observer: MutationObserver | null = null
  /** Payloads ya procesados. Se poda: una reunión larga puede acumular miles de mensajes. */
  private readonly seen = new Set<string>()
  private handler: ((msg: Msg) => void) | null = null
  private key: CryptoKey | null = null

  /**
   * Escribir en el chat está apagado por defecto. Leer y ocultar mensajes ajenos sigue activo
   * siempre: cuesta nada y evita que veas el ruido de otra persona con la extensión.
   */
  private enabled = false

  private outbox: Msg[] = []
  private flushing = false
  /** Envíos fallidos seguidos. Sirve para avisar en vez de reintentar en silencio para siempre. */
  private failures = 0
  private sent = 0
  private received = 0
  /** Para no clickear el botón del chat una y otra vez si Meet no lo abre. */
  private lastOpenAttempt = 0

  /**
   * Mantener el panel de chat abierto mientras se comparte la cola.
   *
   * No alcanza con abrirlo al enviar: con el panel cerrado Meet ni siquiera monta los mensajes
   * entrantes en el DOM, así que también dejaríamos de recibir lo que hacen los demás.
   */
  private keepOpen = false
  private keepTimer: ReturnType<typeof setInterval> | null = null
  private wasOpen = false
  /** Veces seguidas que lo reabrimos. Pasado el límite dejamos de insistir: ver `onReopen`. */
  private reopens = 0
  private onReopen: ((count: number) => void) | null = null

  /** `notify` recibe cuántas veces seguidas hubo que reabrirlo, para poder dejar de forzarlo. */
  setKeepOpen(keepOpen: boolean, notify?: (count: number) => void): void {
    this.keepOpen = keepOpen
    this.onReopen = notify ?? null
    this.reopens = 0

    if (this.keepTimer !== null) clearInterval(this.keepTimer)
    this.keepTimer = keepOpen ? setInterval(() => this.holdChatOpen(), 1500) : null
  }

  /** Vuelve a contar desde cero: el usuario decidió que siga abierto. */
  resetReopens(): void {
    this.reopens = 0
  }

  private holdChatOpen(): void {
    if (!this.keepOpen || !this.enabled) return

    const open = findChatInput() !== null
    if (open) {
      this.wasOpen = true
      return
    }

    // Sólo lo reabrimos si antes lo vimos abierto: así no vamos clickeando botones a ciegas.
    if (!this.wasOpen) return
    if (this.reopens >= 3) return

    this.reopens++
    this.onReopen?.(this.reopens)
    void this.ensureChatOpen()
  }
  private timer: ReturnType<typeof setTimeout> | null = null

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    if (enabled) this.flush()
  }

  /** La clave sale del código de la reunión; sin ella no se lee ni se escribe nada. */
  setKey(key: CryptoKey): void {
    this.key = key
    this.flush()
  }

  start(onMessage: (msg: Msg) => void): void {
    this.handler = onMessage
    void this.scan(document.body)
    this.observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) void this.scan(node)
        if (record.type === 'characterData' && record.target.parentElement) {
          void this.scan(record.target.parentElement)
        }
      }
    })
    this.observer.observe(document.body, { childList: true, subtree: true, characterData: true })
  }

  stop(): void {
    this.observer?.disconnect()
    this.observer = null
    this.handler = null
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
    if (this.keepTimer !== null) clearInterval(this.keepTimer)
    this.keepTimer = null
  }

  /**
   * Meet re-renderiza el chat todo el tiempo, así que el mismo mensaje aparece varias veces.
   * Deduplicamos por payload.
   */
  private async scan(node: Node): Promise<void> {
    if (!(node instanceof Element) && node.nodeType !== Node.TEXT_NODE) return
    unhideRecycled(document)

    const text = node.textContent
    if (!text || !text.includes(WIRE_PREFIX)) return

    const element = node instanceof Element ? node : node.parentElement
    const candidates = element ? [element, ...Array.from(element.querySelectorAll('*'))] : []

    for (const el of candidates) {
      const own = directText(el)
      const match = own && WIRE_RE.exec(own)
      if (!match) continue

      // Se oculta aunque no descifre: si tiene nuestro formato, es ruido para el humano igual.
      hideBubble(el)

      const payload = match[1]
      if (this.seen.has(payload) || !this.key) continue

      if (this.seen.size >= SEEN_MAX) {
        // Los más viejos ya no van a reaparecer: el chat sólo crece hacia abajo.
        for (const old of [...this.seen].slice(0, SEEN_MAX / 2)) this.seen.delete(old)
      }
      this.seen.add(payload)

      const msg = await openMsg(this.key, own)
      if (msg) {
        this.received++
        this.handler?.(msg)
      }
    }
  }

  /** ¿Podemos escribir en el chat? Si no, el panel se degrada a modo DJ-only. */
  canSend(): boolean {
    return this.enabled && this.key !== null && findChatInput() !== null
  }

  /** True cuando venimos fallando al enviar: el panel lo usa para decirlo en vez de callarlo. */
  isStuck(): boolean {
    return this.failures >= 3 && this.outbox.length > 0
  }

  /**
   * Estado del transporte. El DOM de Meet no se puede inspeccionar desde acá, así que la extensión
   * tiene que poder contar qué encontró y qué logró.
   */
  diagnostics(): ChatDiagnostics {
    const input = findChatInput()
    return {
      chatOpen: input !== null,
      sendButton: input ? findSendButton(input) !== null : false,
      sent: this.sent,
      received: this.received,
      pending: this.outbox.length,
      failures: this.failures,
    }
  }

  /**
   * Encola el mensaje. Devuelve false si el chat no está disponible, para que el panel avise en vez
   * de fallar mudo. El envío en sí es diferido: ver `flush`.
   */
  send(msg: Msg): boolean {
    if (!this.canSend()) return false

    // Para estos mensajes sólo importa el último valor: si hay uno esperando, se reemplaza en vez
    // de encolar otro. Mover un slider no debe dejar una fila de mensajes obsoletos en el chat.
    if (LATEST_WINS.has(msg.op)) {
      const pending = this.outbox.findIndex((m) => m.op === msg.op)
      if (pending !== -1) {
        this.outbox[pending] = msg
        this.flush()
        return true
      }
    }

    if (this.outbox.length >= OUTBOX_MAX) this.outbox.shift()
    this.outbox.push(msg)
    this.flush()
    return true
  }

  /**
   * Envía de a uno y sólo cuando no estorba.
   *
   * Escribir en el chat implica pisar el campo de texto, así que si estás redactando un mensaje
   * esperamos: nunca queremos borrarte lo que estabas tipeando. Y aun cuando el campo esté libre,
   * guardamos y restauramos el borrador y el foco.
   */
  private flush(): void {
    if (this.flushing || this.outbox.length === 0) return
    if (!this.enabled || !this.key) return

    const input = findChatInput()
    if (!input) {
      // El campo sólo existe con el panel de chat abierto. Lo abrimos recién cuando hay algo que
      // mandar, en vez de forzarlo al entrar a la reunión.
      this.tryOpenChat()
      this.retryLater()
      return
    }
    if (isComposing(input)) {
      this.retryLater()
      return
    }

    this.flushing = true
    const msg = this.outbox[0]

    void sealMsg(this.key, msg)
      .then(async (wire) => {
        // Revalidamos: entre el cifrado y ahora pudiste haber empezado a escribir.
        const target = findChatInput()
        if (!target || isComposing(target)) return

        if (await submit(target, wire)) {
          this.outbox.shift()
          this.sent++
          this.failures = 0
        } else {
          this.failures++
        }
      })
      .catch(() => undefined)
      .finally(() => {
        this.flushing = false
        if (this.outbox.length > 0) this.retryLater()
      })
  }

  private tryOpenChat(): void {
    const now = Date.now()
    if (now - this.lastOpenAttempt < 30_000) return
    this.lastOpenAttempt = now
    void this.ensureChatOpen()
  }

  private retryLater(): void {
    if (this.timer !== null) return
    this.timer = setTimeout(() => {
      this.timer = null
      this.flush()
    }, RETRY_MS)
  }

  /** Abre el panel de chat si está cerrado. Sin él no hay campo donde escribir. */
  async ensureChatOpen(): Promise<boolean> {
    if (findChatInput()) return true
    const button = findChatButton()
    if (!button) return false
    button.click()
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 100))
      if (findChatInput()) return true
    }
    return false
  }
}

/**
 * ¿Estás escribiendo un mensaje ahora mismo? Entonces el campo no se toca.
 *
 * Se mira **sólo si hay texto**, no si el campo tiene el foco. Meet enfoca el campo solo al abrir
 * el panel de chat, así que tomar el foco como señal creaba un bloqueo circular: abríamos el chat
 * para poder enviar, Meet lo enfocaba, y nos negábamos a escribir creyendo que estabas tipeando.
 * Con el campo vacío escribir es inofensivo: restauramos foco y borrador igual.
 */
const isComposing = (input: HTMLElement): boolean => {
  const text = input instanceof HTMLTextAreaElement ? input.value : (input.textContent ?? '')
  return text.trim().length > 0
}

/** Texto propio del elemento, sin el de sus hijos: así identificamos la burbuja exacta. */
const directText = (el: Element): string => {
  let out = ''
  for (const child of el.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) out += child.textContent ?? ''
  }
  return out.trim()
}

/**
 * Devuelve a la vista lo que ocultamos si el nodo dejó de contener un mensaje nuestro.
 *
 * Meet puede reciclar los nodos del chat al desplazarse. Sin esto, un elemento que escondimos
 * podría reaparecer con el mensaje de una persona y quedar invisible para siempre.
 */
const unhideRecycled = (root: ParentNode): void => {
  for (const el of root.querySelectorAll<HTMLElement>('[data-meet-music-hidden]')) {
    if (WIRE_RE.test(el.textContent ?? '')) continue
    el.style.removeProperty('display')
    el.removeAttribute('data-meet-music-hidden')
  }
}

/**
 * Oculta la burbuja del mensaje. Subimos unos niveles porque el nodo con el texto suele estar
 * anidado dentro del contenedor que además muestra el autor y la hora.
 */
const hideBubble = (el: Element): void => {
  let target: Element = el
  for (let i = 0; i < 4; i++) {
    const parent = target.parentElement
    if (!parent || parent === document.body) break
    // Si el padre ya tiene otro contenido además de nuestro mensaje, no lo escondemos.
    if (parent.textContent && !WIRE_RE.test(parent.textContent)) break
    target = parent
  }
  ;(target as HTMLElement).style.display = 'none'
  target.setAttribute('data-meet-music-hidden', 'true')
}

const findChatInput = (): HTMLElement | null => {
  const textareas = Array.from(document.querySelectorAll<HTMLTextAreaElement>('textarea'))
  const byLabel = textareas.find((t) => looksLikeChat(t) && isVisible(t))
  if (byLabel) return byLabel

  const boxes = Array.from(
    document.querySelectorAll<HTMLElement>('[contenteditable="true"], [role="textbox"]'),
  )
  return boxes.find((b) => looksLikeChat(b) && isVisible(b)) ?? null
}

/** Meet deja en el DOM paneles ocultos; escribir en uno de esos no manda nada. */
const isVisible = (el: HTMLElement): boolean => el.offsetParent !== null || el.getClientRects().length > 0

const looksLikeChat = (el: HTMLElement): boolean => {
  const hints = [
    el.getAttribute('aria-label'),
    el.getAttribute('placeholder'),
    el.getAttribute('data-placeholder'),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  if (!hints) return false
  // Multilingüe a propósito: Meet está en el idioma de la cuenta, no en el de la extensión.
  return /mensaje|message|chat|mensagem|enviar|send/.test(hints)
}

/**
 * El botón de enviar del chat.
 *
 * Es la vía preferida frente a simular Enter: un `click()` sintético dispara los manejadores del
 * framework igual que uno real, mientras que un KeyboardEvent fabricado llega con `isTrusted` en
 * false y hay handlers que lo descartan. Se busca cerca del campo para no confundirlo con el botón
 * que abre el chat, que tiene una etiqueta parecida.
 */
const findSendButton = (input: HTMLElement): HTMLElement | null => {
  let scope: HTMLElement | null = input
  for (let i = 0; i < 5 && scope; i++) {
    const candidates = Array.from(
      scope.querySelectorAll<HTMLElement>('button, [role="button"]'),
    ).filter((b) => {
      const label = (b.getAttribute('aria-label') ?? b.textContent ?? '').toLowerCase()
      return /enviar|send/.test(label) && isVisible(b)
    })
    if (candidates.length > 0) return candidates[candidates.length - 1]
    scope = scope.parentElement
  }
  return null
}

const findChatButton = (): HTMLElement | null => {
  const buttons = Array.from(document.querySelectorAll<HTMLElement>('button, [role="button"]'))
  return (
    buttons.find((b) => {
      const label = (b.getAttribute('aria-label') ?? b.textContent ?? '').toLowerCase()
      return /chat|mensaje|message/.test(label) && isVisible(b)
    }) ?? null
  )
}

/**
 * Escribe en el campo y manda.
 *
 * React (y el framework de Meet) ignoran las asignaciones directas a `.value`, así que hay que usar
 * el setter nativo del prototipo y disparar el evento a mano.
 *
 * Escribir acá implica pisar el campo, así que guardamos lo que hubiera y el foco, y lo devolvemos
 * al terminar. Combinado con `isComposing`, la idea es que nunca pierdas un mensaje a medio
 * escribir por culpa nuestra.
 *
 * Devuelve false si el mensaje NO se fue: lo verificamos mirando si el campo quedó vacío, en vez de
 * asumir que salió. Sin esa verificación, un fallo silencioso deja la cola compartida rota sin que
 * nadie se entere.
 */
const submit = async (input: HTMLElement, text: string): Promise<boolean> => {
  const isTextarea = input instanceof HTMLTextAreaElement
  const read = (): string => (isTextarea ? input.value : (input.textContent ?? ''))
  const draft = read()
  const previouslyFocused = document.activeElement as HTMLElement | null

  const write = (value: string): void => {
    if (isTextarea) {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
      setter?.call(input, value)
    } else {
      input.textContent = value
    }
    input.dispatchEvent(new InputEvent('input', { bubbles: true, data: value }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }

  const restore = (): void => {
    if (draft) write(draft)
    if (previouslyFocused && previouslyFocused !== input) previouslyFocused.focus()
  }

  try {
    input.focus()
    write(text)

    // Preferimos el botón; Enter queda como respaldo por si no aparece.
    const button = findSendButton(input)
    if (button) button.click()
    else pressEnter(input)

    // Meet limpia el campo al enviar: si sigue con nuestro texto, no se fue.
    await new Promise((r) => setTimeout(r, 120))
    if (read().includes(text)) {
      pressEnter(input)
      await new Promise((r) => setTimeout(r, 120))
    }

    const sent = !read().includes(text)
    restore()
    return sent
  } catch {
    restore()
    return false
  }
}

const pressEnter = (input: HTMLElement): void => {
  for (const type of ['keydown', 'keypress', 'keyup']) {
    input.dispatchEvent(
      new KeyboardEvent(type, {
        bubbles: true,
        cancelable: true,
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
      } as KeyboardEventInit),
    )
  }
}
