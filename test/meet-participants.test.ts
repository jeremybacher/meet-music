import { describe, expect, it } from 'vitest'
import { isPeopleLabel, parseCountFromLabel } from '../src/content/meet-participants.js'

describe('reconocer el botón de personas', () => {
  it('lo encuentra en varios idiomas', () => {
    expect(isPeopleLabel('Show everyone')).toBe(true)
    expect(isPeopleLabel('Mostrar a todos')).toBe(true)
    expect(isPeopleLabel('Personas')).toBe(true)
    expect(isPeopleLabel('Participantes')).toBe(true)
    expect(isPeopleLabel('Teilnehmer anzeigen')).toBe(true)
  })

  /**
   * "Chat with everyone" matchea `everyone` igual que "Show everyone", y su insignia es la de
   * mensajes sin leer. Confundirlos hace que cada mensaje del chat parezca alguien entrando y la
   * extensión se ponga a escribir avisos sola, que es el peor fallo posible acá.
   */
  it('no confunde el botón de chat con el de personas', () => {
    expect(isPeopleLabel('Chat with everyone')).toBe(false)
    expect(isPeopleLabel('Chat con todos')).toBe(false)
    expect(isPeopleLabel('Mensajes con todos')).toBe(false)
  })

  it('no toma cualquier botón', () => {
    expect(isPeopleLabel('Silenciar micrófono')).toBe(false)
    expect(isPeopleLabel('')).toBe(false)
  })
})

describe('contador dentro de la etiqueta', () => {
  it('lee el número entre paréntesis', () => {
    expect(parseCountFromLabel('Show everyone (12)')).toBe(12)
  })

  it('lee el número que abre la etiqueta', () => {
    expect(parseCountFromLabel('3 participants')).toBe(3)
    expect(parseCountFromLabel('2 personas en la llamada')).toBe(2)
  })

  it('no toma cualquier número que aparezca', () => {
    expect(parseCountFromLabel('Chat with everyone ctrl 5')).toBeNull()
    expect(parseCountFromLabel('Personas')).toBeNull()
    expect(parseCountFromLabel('Show everyone')).toBeNull()
  })
})
