/**
 * Ajustes de Opus sobre el SDP de nuestro enlace interno YouTube → Meet.
 *
 * Por defecto WebRTC negocia Opus para voz: mono, banda angosta y con DTX, que recorta lo que
 * interpreta como silencio. Para música es lo peor posible, y encima ese enlace es sólo el primer
 * tramo — si acá ya se degrada, no hay forma de recuperarlo después.
 *
 * Este tramo es enteramente nuestro (los dos extremos están en el mismo navegador), así que subirlo
 * a estéreo y buen bitrate no arriesga nada: no hay red de por medio.
 */

const MUSIC_PARAMS: Record<string, string> = {
  stereo: '1',
  'sprop-stereo': '1',
  maxaveragebitrate: '192000',
  maxplaybackrate: '48000',
  useinbandfec: '1',
  // DTX corta la transmisión en los pasajes suaves: en música se escucha como cortes.
  usedtx: '0',
  cbr: '0',
}

export const preferHighQualityOpus = (sdp: string): string => {
  const payloadTypes = [...sdp.matchAll(/^a=rtpmap:(\d+)\s+opus\/48000(?:\/2)?/gim)].map((m) => m[1])
  if (payloadTypes.length === 0) return sdp

  let out = sdp
  for (const pt of payloadTypes) {
    const fmtp = new RegExp(`^a=fmtp:${pt} (.*)$`, 'im')
    const existing = fmtp.exec(out)

    if (existing) {
      out = out.replace(fmtp, `a=fmtp:${pt} ${mergeParams(existing[1])}`)
    } else {
      // Sin línea previa, se agrega justo después del rtpmap correspondiente.
      const rtpmap = new RegExp(`^(a=rtpmap:${pt}\\s+opus/48000(?:/2)?.*)$`, 'im')
      out = out.replace(rtpmap, `$1\r\na=fmtp:${pt} ${serialize(MUSIC_PARAMS)}`)
    }
  }
  return out
}

/** Respeta lo que ya venía negociado y sólo pisa lo que nos importa para música. */
const mergeParams = (raw: string): string => {
  const params: Record<string, string> = {}
  for (const pair of raw.split(';')) {
    const [key, value] = pair.split('=')
    if (key?.trim()) params[key.trim()] = (value ?? '').trim()
  }
  return serialize({ ...params, ...MUSIC_PARAMS })
}

const serialize = (params: Record<string, string>): string =>
  Object.entries(params)
    .map(([k, v]) => `${k}=${v}`)
    .join(';')

/**
 * Le pide al codificador que no se limite al bitrate de voz. Complementa al SDP: sin esto, Chrome
 * puede quedarse muy por debajo de lo negociado.
 */
export const raiseAudioBitrate = async (sender: RTCRtpSender, bitrate = 192_000): Promise<void> => {
  try {
    const params = sender.getParameters()
    params.encodings = params.encodings?.length ? params.encodings : [{}]
    for (const encoding of params.encodings) encoding.maxBitrate = bitrate
    await sender.setParameters(params)
  } catch {
    // Algunos navegadores no dejan tocar los parámetros de audio; se sigue con lo negociado.
  }
}
