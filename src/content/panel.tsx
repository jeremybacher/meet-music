/**
 * Punto de entrada del panel. Monta la UI dentro de un shadow root para que el CSS de Meet no nos
 * afecte y el nuestro no le afecte a Meet.
 */
import { render } from 'preact'
import { App } from './app.js'
import { PANEL_CSS } from './styles.js'

const HOST_ID = 'meet-music-root'

const mount = (): void => {
  if (document.getElementById(HOST_ID)) return

  const host = document.createElement('div')
  host.id = HOST_ID
  document.body.appendChild(host)

  const shadow = host.attachShadow({ mode: 'open' })
  const style = document.createElement('style')
  style.textContent = PANEL_CSS
  shadow.appendChild(style)

  const container = document.createElement('div')
  shadow.appendChild(container)

  // App decide si hay algo que mostrar: fuera de una llamada no monta nada ni abre sesión.
  render(<App />, container)
}

// Meet es una SPA: el body puede no existir todavía a document_idle en una navegación interna.
if (document.body) mount()
else document.addEventListener('DOMContentLoaded', mount, { once: true })
