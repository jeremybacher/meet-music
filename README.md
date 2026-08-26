# Meet Music

Cola de música compartida dentro de Google Meet. **El resto de la reunión escucha sin instalar
nada**: el audio va mezclado en la pista de micrófono de quien pone la música.

> La interfaz de la extensión está en inglés; esta documentación y los comentarios del código, en
> español. Los patrones que buscan elementos del DOM de Meet siguen siendo multilingües, porque Meet
> se muestra en el idioma de la cuenta de cada usuario.

---

## Instalación

**Desde una release** (recomendado, no requiere compilar):

1. Bajá el `.zip` de la [última release](../../releases/latest) y descomprimilo.
2. Abrí `chrome://extensions` y activá **Modo desarrollador**.
3. **Cargar descomprimida** → elegí la carpeta.

Guardá la carpeta: Chrome carga la extensión desde ahí, así que borrarla la desinstala.

**Desde el código**:

```bash
corepack enable   # el proyecto usa pnpm
pnpm install
pnpm build        # deja todo en dist/
```

Y cargá `dist/` con los mismos pasos.

Requiere Chrome 116 o superior.

---

## Uso

Entrá a una reunión de Meet: aparece un botón con una nota musical al lado de los controles. El
panel no existe fuera de una llamada.

1. **Pegá el link de un video de YouTube.** No hay búsqueda por nombre en esta versión.
2. **Play music here** abre una pestaña de YouTube con esa canción y empieza a mezclar. La primera
   vez Chrome puede pedir un clic en esa pestaña para permitir el audio: el panel te avisa y te
   lleva, y volvés solo.
3. **Regulá el volumen.** Quien reproduce tiene tres perillas independientes —música en la reunión,
   música sólo para sí, y su voz—; el resto ve botones de subir y bajar, que cambian el volumen para
   todos.
4. **Mute my voice** te calla sin cortar la música. El botón de mutear de Meet no puede hacer eso,
   porque música y voz van en una sola pista mezclada.

**Usá auriculares.** Con parlantes, tu micrófono vuelve a captar la música y la reunión la escucha
dos veces, ligeramente corrida.

### Cola compartida

Para que otros agreguen canciones necesitan **esta misma extensión instalada**. La cola viaja por el
chat de Meet, en mensajes cifrados y ocultos: es el único canal común entre participantes cuando no
hay servidor.

**Cualquiera puede agregar, saltear, pausar y mover el volumen.** No hay votación ni permisos: la
cola es de la reunión, no de quien la puso. **Stop and clear queue** corta la música, vacía la cola y
libera el puesto, así que cualquiera puede arrancar de cero.

El panel de chat de Meet **se mantiene abierto** mientras esto está activo: con el panel cerrado Meet
ni siquiera monta los mensajes entrantes, así que dejarías de recibir lo que hacen los demás. Si lo
cerrás tres veces, la extensión deja de insistir y te da a elegir.

Se puede apagar en ⚙ → *Share the queue with the meeting*, a costa de quedarse sin cola compartida.

---

## Limitaciones conocidas

Ninguna es un bug: salen del modelo de inyectar audio en el micrófono.

- **La música se escucha peor que el original.** Meet codifica la pista de micrófono pensando en voz.
  Es el precio de que nadie más tenga que instalar nada.
- **Silenciarte con el botón de Meet corta también la música**, porque es una sola pista. Para eso
  está *Mute my voice*.
- **El volumen no puede ser individual.** A quien escucha le llega la música fusionada con la voz de
  quien la pone; bajarla bajaría también su voz.
- **Anuncios de YouTube.** Sin Premium suenan en la reunión. La extensión los detecta y baja el
  volumen sola mientras duran.
- **Spotify no es posible** en este modelo: reproduce con DRM y el audio protegido no se puede
  capturar.
- **Quien no tenga la extensión ve texto raro en el chat** cuando la cola está compartida.
- **Si quien reproduce cierra la pestaña sin parar**, los demás lo siguen viendo como DJ hasta que
  alguien usa *Stop and clear queue*.
- **El DOM de Meet cambia sin aviso.** Si el transporte por chat deja de andar, la extensión se
  degrada sola a modo individual en vez de romperse.

---

## Cómo funciona

Google Meet no expone ninguna API para extensiones, así que no hay forma oficial de inyectar audio.
La extensión intercepta `getUserMedia` en la página de Meet y le devuelve un track mezclado: tu voz
más la música.

```
┌─ Navegador de quien reproduce ─────────────────────────────────────┐
│  Pestaña de YouTube (fijada, en segundo plano)                     │
│  └─ content script: Web Audio sobre el <video>                     │
│            │                                                       │
│            │ WebRTC local          Service Worker                  │
│            │ (candidatos de host)  └─ relé de señalización         │
│            ▼                                                       │
│  Pestaña de Meet                                                   │
│  ├─ [ISOLATED] panel + transporte por el chat de Meet              │
│  └─ [MAIN] patch de getUserMedia + mezclador                       │
└────────────────────────────────────────────────────────────────────┘
        │ audio mezclado, vía Meet
        ▼  el resto de la reunión, sin instalar nada
```

### El audio

Se toma con `createMediaElementSource` sobre el `<video>` de una página real de YouTube. A diferencia
de `captureStream()`, se ata **al elemento** y no al recurso, así que sobrevive los cambios de
canción; `captureStream()` queda como plan B. En una página real, además, la detección de anuncios es
confiable (la clase `ad-showing`) en vez de una heurística.

**`chrome.tabCapture` no sirve**: sólo puede apuntar a pestañas donde el usuario haya *invocado* la
extensión (clic en el ícono, atajo, menú contextual), y una pestaña de reproductor en segundo plano
nunca cumple eso.

Dos decisiones deliberadas sobre la voz:

- **Mientras no haya música, la extensión no toca nada.** `getUserMedia` devuelve el micrófono tal
  cual y ni siquiera se crea un `AudioContext`. Al empezar la música se arma el mezclador y se cambia
  la pista en caliente con `RTCRtpSender.replaceTrack()`.
- **La voz no pasa por ningún nodo de procesamiento**, sólo por una ganancia. El limitador cuelga de
  la rama de música. Hay un test que verifica esa topología.

### El transporte

Los mensajes van **cifrados con AES-GCM**, con la clave derivada del **código de la reunión**: un
secreto que ya comparten todos los de adentro y nadie de afuera, sin nada que configurar.

- La cola es ilegible para cualquiera que no esté en esa reunión.
- **Nadie puede inyectar órdenes escribiendo en el chat**: AES-GCM autentica, así que un mensaje que
  no salió de la extensión no descifra y se descarta.
- Enviar **nunca pisa lo que estés escribiendo**: si el campo tiene texto, el envío se posterga, y se
  guarda y restaura el borrador y el foco.

No pretende resistir a un participante malicioso de la propia reunión: quien tiene el código tiene la
clave.

Cada participante tiene un **id estable** separado del nombre visible. Van aparte a propósito: si la
identidad fuera el nombre, dos personas con el nombre por defecto contarían como una sola.

---

## Desarrollo

```bash
pnpm dev        # esbuild en modo observación
pnpm test           # 61 tests
pnpm typecheck
pnpm build
```

Tras cada build hay que recargar la extensión en `chrome://extensions`.

Los tests cubren lo que se puede aislar: el reducer de la cola, el protocolo, el cifrado, el
mezclador (con un `AudioContext` falso), el tema y el parsing de URLs. **El patch de audio y el
transporte por chat se verifican a mano**, con dos cuentas de Google en una reunión real.

### Estructura

| Archivo | Qué hace |
|---|---|
| `src/content/mic-patch.ts` | Mundo MAIN. Intercepta `getUserMedia` y devuelve el track mezclado. |
| `src/core/mixer.ts` | El grafo de Web Audio. Garantiza que la música no toque la voz. |
| `src/content/session.ts` | Estado del panel, roles, cableado. |
| `src/content/chat-transport.ts` | Cola compartida sobre el chat de Meet, sin pisar tus borradores. |
| `src/core/crypto.ts` | AES-GCM con la clave derivada del código de la reunión. |
| `src/core/sdp.ts` | Fuerza Opus estéreo y sin DTX en el enlace interno. |
| `src/background/service-worker.ts` | Pestaña de YouTube y relé de señalización. |
| `src/player/yt-content.ts` | Lado YouTube: toma el audio y controla el `<video>`. |
| `src/player/yt-main.ts` | Mundo MAIN de YouTube: cambia de canción sin recargar. |

### El ícono

Los PNG de `src/static/icons/` se generan con Chrome headless a partir del **mismo path de Material
`music_note`** que usa el botón flotante dentro de Meet, para que se reconozcan como lo mismo.

---

## Contribuir

Ver [CONTRIBUTING.md](CONTRIBUTING.md).

## Licencia

[MIT](LICENSE).

Reproducir música en una reunión es responsabilidad de quien la pone. Esta extensión no redistribuye
ni almacena audio: sólo enruta lo que YouTube ya está reproduciendo en tu propio navegador.
