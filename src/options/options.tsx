/** Página de opciones: tema. El resto de los ajustes vive en el panel, dentro de la reunión. */
import { render } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import { type ThemePref } from '../core/theme.js'

function Options() {
  const [theme, setTheme] = useState<ThemePref>('system')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    void chrome.storage.local.get('theme').then((stored) => {
      setTheme((stored.theme as ThemePref | undefined) ?? 'system')
    })
  }, [])

  // `system` quita el atributo para que mande la media query del navegador.
  useEffect(() => {
    const root = document.documentElement
    if (theme === 'system') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', theme)
  }, [theme])

  const save = async () => {
    await chrome.storage.local.set({ theme })
    setSaved(true)
    setTimeout(() => setSaved(false), 1800)
  }

  return (
    <>
      <h1>Meet Music</h1>
      <p class="sub">
        Shared music in Google Meet: paste a YouTube video link and the whole meeting hears it,
        without anyone else installing a thing.
      </p>

      <section>
        <h2>Theme</h2>
        <p>Follows whatever your browser is set to, unless you pick one.</p>
        <label for="theme">Appearance</label>
        <select id="theme" value={theme} onChange={(e) => setTheme((e.target as HTMLSelectElement).value as ThemePref)}>
          <option value="system">Follow the browser</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </section>

      <button onClick={() => void save()}>Save</button>
      <span class="saved" data-on={String(saved)}>Saved</span>
    </>
  )
}

render(<Options />, document.getElementById('root')!)
