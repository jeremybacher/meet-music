/**
 * Tu nombre, sacado de Meet en vez de pedírtelo.
 *
 * Google ya sabe quién sos y lo pone en el `aria-label` del botón de cuenta, con la forma
 * "Cuenta de Google: Nombre Apellido (mail@dominio)". Leerlo evita un campo más que llenar.
 *
 * Es best-effort: si el DOM cambia o no aparece, se cae a un genérico. El nombre es sólo una
 * etiqueta para mostrar — la identidad real para votos y conteo es un id estable aparte.
 */

const EMAIL = /\(\s*[^\s@]+@[^\s)]+\s*\)/

/** Pura y testeable: separar esto del DOM es lo que la hace verificable. */
export const extractNameFromLabel = (label: string): string | null => {
  if (!EMAIL.test(label)) return null

  // "Cuenta de Google: Nombre (mail)" — nos quedamos con lo que va entre los dos puntos y el mail.
  const withPrefix = /:\s*([^:(]+?)\s*\(\s*[^\s@]+@[^\s)]+\s*\)/.exec(label)
  if (withPrefix) return clean(withPrefix[1])

  // "Nombre (mail)", sin prefijo.
  const bare = /^\s*([^:(]+?)\s*\(\s*[^\s@]+@[^\s)]+\s*\)/.exec(label)
  return bare ? clean(bare[1]) : null
}

const clean = (raw: string): string | null => {
  const name = raw.replace(/\s+/g, ' ').trim()
  if (!name || name.length > 60 || name.includes('@')) return null
  return name
}

export const detectDisplayName = (): string | null => {
  const labelled = document.querySelectorAll<HTMLElement>('[aria-label*="@"]')
  for (const el of labelled) {
    const name = extractNameFromLabel(el.getAttribute('aria-label') ?? '')
    if (name) return name
  }
  return null
}
