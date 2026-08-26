# Contribuir

## Arrancar

El proyecto usa **pnpm**. Con Node 22 ya viene por corepack:

```bash
corepack enable
pnpm install
pnpm dev
```

Cargá `dist/` en `chrome://extensions` con **Modo desarrollador** activado. Después de cada build hay
que darle a recargar en esa misma pantalla.

Antes de abrir un PR:

```bash
pnpm typecheck && pnpm test && pnpm build
```

Es lo mismo que corre CI.

## Probarlo de verdad

**Los tests no cubren lo que más se rompe.** El patch de audio y el transporte por el chat dependen
del DOM de Meet y de APIs del navegador que no se pueden simular con fidelidad, así que hay que
probarlos a mano con **dos cuentas de Google** en una reunión real (o una normal y otra en incógnito).

Si tocaste audio o el transporte, verificá al menos esto:

1. La otra cuenta escucha la música.
2. Con música sonando, mové "Music in the meeting" de 0 a 100 mientras hablás: **el volumen de tu voz
   no debe cambiar** y se te tiene que entender en todo el recorrido.
3. Pasar de canción no corta el audio ni deja el título viejo.
4. *Mute my voice* te calla y la música sigue sonando para los demás.
5. Agregar una canción desde la segunda cuenta aparece en la cola de la primera.

El panel trae diagnóstico para no adivinar: el tooltip de la línea de estado dice de dónde sale el
audio, y el de la cola dice `chat open · send button found · sent N · received N`. Si algo falla,
esos números dicen dónde se corta.

## Cómo está pensado

Vale la pena conocer estas cuatro decisiones antes de tocar el código:

- **Instalada pero ociosa, la extensión no toca tu audio.** Sin música, `getUserMedia` devuelve el
  micrófono tal cual y ni siquiera se crea un `AudioContext`. Si agregás algo al camino de la voz,
  que sea sólo cuando hay música.
- **La voz no pasa por ningún nodo de procesamiento**, sólo por una ganancia. Hay un test que
  verifica la topología del grafo; si lo rompés, es a propósito o es un bug.
- **El DOM de Meet no es una API.** Los selectores están centralizados y son heurísticos a propósito,
  y siempre hay un camino de degradación: si algo no se encuentra, la extensión avisa y sigue
  funcionando en modo individual en vez de romperse.
- **El chat es un canal caro.** Cada mensaje es una línea visible para quien no tiene la extensión.
  Antes de mandar algo nuevo, pensá si hace falta y si conviene agruparlo (ver `LATEST_WINS` y el
  retardo del volumen).

## Estilo

- Comentarios y documentación **en español**; todo lo que ve el usuario, **en inglés**.
- Los patrones que buscan cosas en el DOM de Meet son **multilingües**: Meet se muestra en el idioma
  de la cuenta de cada usuario, no en el de la extensión.
- Comentá el **por qué**, no el qué. Los comentarios que más valen son los que explican una decisión
  que parece rara y no lo es.
- Sin dependencias nuevas salvo que resuelvan algo que no se puede hacer a mano. Hoy son dos:
  `preact` y `esbuild`.

## Reportar un problema

Con el audio, incluí:

- Qué dice la línea de diagnóstico del panel (y su tooltip).
- Si el problema es tuyo o de quien escucha — **no es lo mismo** y lleva a diagnósticos opuestos.
- Versión de Chrome y sistema operativo.

## Publicar una versión

1. Subí `version` en `src/static/manifest.json` y en `package.json`.
2. Etiquetá: `git tag v0.2.0 && git push --tags`.

El workflow de release compila, corre los tests, **verifica que la etiqueta coincida con la versión
del manifest** y publica el zip listo para instalar.
