import { describe, expect, it } from 'vitest'
import { formatDuration, parseVideoId } from '../src/youtube/parse-url.js'

describe('parseVideoId', () => {
  it('acepta las formas que la gente realmente pega', () => {
    const cases: Array<[string, string]> = [
      ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
      ['https://youtu.be/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
      ['https://youtu.be/dQw4w9WgXcQ?t=42', 'dQw4w9WgXcQ'],
      ['https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=RDAMVM', 'dQw4w9WgXcQ'],
      ['https://m.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
      ['https://www.youtube.com/shorts/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
      ['https://www.youtube.com/embed/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
      ['https://www.youtube.com/live/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
      ['youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
      ['  https://www.youtube.com/watch?v=dQw4w9WgXcQ  ', 'dQw4w9WgXcQ'],
      ['dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ]
    for (const [input, expected] of cases) {
      expect(parseVideoId(input), input).toBe(expected)
    }
  })

  it('devuelve null para texto libre, que es lo que dispara la búsqueda', () => {
    expect(parseVideoId('daft punk around the world')).toBeNull()
    expect(parseVideoId('')).toBeNull()
    expect(parseVideoId('https://vimeo.com/123456')).toBeNull()
    expect(parseVideoId('https://www.youtube.com/')).toBeNull()
    // Diez caracteres: no es un id válido.
    expect(parseVideoId('dQw4w9WgXc')).toBeNull()
  })
})

describe('formatDuration', () => {
  it('agrega la hora sólo cuando hace falta', () => {
    expect(formatDuration(253)).toBe('4:13')
    expect(formatDuration(3723)).toBe('1:02:03')
    expect(formatDuration(9)).toBe('0:09')
  })

  it('muestra un placeholder mientras no sabemos la duración', () => {
    expect(formatDuration(undefined)).toBe('--:--')
    expect(formatDuration(Number.NaN)).toBe('--:--')
  })
})
