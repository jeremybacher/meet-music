/**
 * CSS del panel. Vive en un string porque se inyecta dentro de un shadow root: así el CSS de Meet
 * no nos toca y el nuestro no le toca nada a Meet.
 *
 * Sigue el lenguaje visual de Google Meet: superficies grises neutras (nada de tintes), azul de
 * Google como acento, botones tipo píldora, radios amplios y la familia Google Sans. Los colores
 * son variables definidas dos veces —`[data-theme="light"]` y `[data-theme="dark"]`— y el panel
 * resuelve cuál usar; por defecto sigue al navegador.
 */
export const PANEL_CSS = `
:host { all: initial; }


* {
  box-sizing: border-box;
  font-family: "Google Sans", "Google Sans Text", Roboto, system-ui, -apple-system, Arial, sans-serif;
}

.root[data-theme="dark"] {
  --bg: #1e1f20;
  --bg-sunken: #131314;
  --bg-raised: #2d2f31;
  --bg-hover: #37393b;
  --border: #444746;
  --text: #e3e3e3;
  --text-dim: #c4c7c5;
  --text-faint: #9aa0a6;
  --accent: #a8c7fa;
  --accent-hover: #c2ddff;
  --accent-text: #062e6f;
  --live: #0b2a5b;
  --live-text: #a8c7fa;
  --warn-bg: #402d00;
  --warn-text: #fdd663;
  --error-bg: #4d1f1c;
  --error-text: #f2b8b5;
  --info-bg: #0b2a5b;
  --info-text: #a8c7fa;
  --shadow: 0 8px 28px rgba(0,0,0,.45);
  --launcher-shadow: 0 2px 8px rgba(0,0,0,.35);
  --launcher-bg: #3c4043;
  --launcher-bg-hover: #4a4d51;
  --launcher-fg: #e3e3e3;
  --launcher-on-bg: #a8c7fa;
  --launcher-on-fg: #062e6f;
  --focus-ring: #a8c7fa;
}

.root[data-theme="light"] {
  --bg: #ffffff;
  --bg-sunken: #f8fafd;
  --bg-raised: #f0f4f9;
  --bg-hover: #e1e6ec;
  --border: #c4c7c5;
  --text: #1f1f1f;
  --text-dim: #444746;
  --text-faint: #5f6368;
  --accent: #0b57d0;
  --accent-hover: #0842a0;
  --accent-text: #ffffff;
  --live: #d3e3fd;
  --live-text: #0842a0;
  --warn-bg: #fef7e0;
  --warn-text: #8f6100;
  --error-bg: #fce8e6;
  --error-text: #a50e0e;
  --info-bg: #e8f0fe;
  --info-text: #0b57d0;
  --shadow: 0 8px 28px rgba(60,64,67,.22);
  --launcher-shadow: 0 2px 8px rgba(60,64,67,.25);
  --launcher-bg: #e8eaed;
  --launcher-bg-hover: #dadce0;
  --launcher-fg: #1f1f1f;
  --launcher-on-bg: #0b57d0;
  --launcher-on-fg: #ffffff;
  --focus-ring: #0b57d0;
}

/* Los flotantes van en fila, como la barra de controles de Meet. */
.dock {
  position: fixed; right: 18px; bottom: 92px; z-index: 2147483000;
  display: flex; align-items: center; gap: 10px;
}

/* Mismas proporciones que los botones de la barra de Meet: círculo de 48px con ícono de 24px. */
.launcher {
  position: relative;
  width: 48px; height: 48px; border-radius: 50%; border: 0; padding: 0; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
  background: var(--launcher-bg); color: var(--launcher-fg);
  box-shadow: var(--launcher-shadow);
  transition: background-color .15s ease, color .15s ease;
}
.launcher svg { width: 24px; height: 24px; display: block; fill: currentColor; }
.launcher:hover { background: var(--launcher-bg-hover); }
.launcher:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }
.launcher[data-active="true"] { background: var(--launcher-on-bg); color: var(--launcher-on-fg); }

/* Voz silenciada: el mismo rojo con el que Meet marca el micrófono cortado. */
.launcher[data-muted="true"] { background: #ea4335; color: #ffffff; }
.launcher[data-muted="true"]:hover { background: #d33426; }

/*
 * El botón que ocupa el lugar del de micrófono de Meet. La geometría y los colores llegan inline,
 * medidos del botón que tapa: es la única forma de que coincida con el tema de Meet, que no tiene
 * por qué ser el que el usuario eligió para el panel.
 *
 * Sin sombra: los botones de la barra de Meet no la tienen, y una lo delataría como pegado encima.
 * El ícono va en proporción, no en píxeles fijos, porque esa barra se achica con la ventana.
 */
.launcher[data-overlay="true"] {
  position: fixed; z-index: 2147483000; box-shadow: none;
}
.launcher[data-overlay="true"] svg { width: 50%; height: 50%; }

/* Punto de "sonando", como el indicador de actividad de los controles de Meet. */
.launcher .dot {
  position: absolute; top: 4px; right: 4px; width: 9px; height: 9px; border-radius: 50%;
  background: #34a853; border: 2px solid var(--launcher-bg);
}
/* Suena en la reunión pero la pone otra persona: es información distinta, y merece otro color. */
.launcher .dot[data-tone="remote"] { background: var(--accent); }

/* Meet redondea sus paneles laterales a 16px y los apoya con una sombra suave, sin borde duro. */
.panel {
  position: fixed; right: 18px; bottom: 150px; z-index: 2147483000;
  width: 360px; max-height: min(76vh, 700px); display: flex; flex-direction: column;
  background: var(--bg); color: var(--text); border-radius: 16px;
  box-shadow: var(--shadow); overflow: hidden; font-size: 14px;
}

header { display: flex; align-items: center; gap: 8px; padding: 16px 12px 12px 20px; }
header h2 { margin: 0; font-size: 16px; font-weight: 400; flex: 1; letter-spacing: 0; }
.badge {
  font-size: 12px; padding: 4px 10px; border-radius: 100px;
  background: var(--bg-raised); color: var(--text-dim);
}
.badge[data-tone="live"] { background: var(--live); color: var(--live-text); }
/* Listo pero sin salir al aire: no es un error, pero tampoco puede parecer que todo está bien. */
.badge[data-tone="warn"] { background: var(--warn-bg); color: var(--warn-text); }

/* Botones de ícono redondos con área táctil, como los de la cabecera de los paneles de Meet. */
.icon-btn {
  background: none; border: 0; color: var(--text-dim); cursor: pointer; font-size: 16px;
  width: 36px; height: 36px; border-radius: 50%; display: inline-flex;
  align-items: center; justify-content: center; flex: none;
}
.icon-btn:hover { background: var(--bg-hover); color: var(--text); }
.icon-btn:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: -2px; }

.body { overflow-y: auto; padding: 4px 20px 20px; display: flex; flex-direction: column; gap: 16px; }

/* Contenedor de avisos. Vacío no ocupa nada: sin esto dejaba el hueco del gap del cuerpo. */
.banners { display: grid; gap: 10px; }
.banners:empty { display: none; }

.banner { padding: 12px 14px; border-radius: 12px; font-size: 13px; line-height: 1.45; }
.banner[data-tone="warn"] { background: var(--warn-bg); color: var(--warn-text); }
.banner[data-tone="error"] { background: var(--error-bg); color: var(--error-text); }
.banner[data-tone="info"] { background: var(--info-bg); color: var(--info-text); }
.banner button { margin-top: 10px; display: block; }
/* Dentro de un banner los controles van en la paleta del banner, no en la del panel: el azul de
   acento sobre el rojo de error se lee como dos cosas que no tienen nada que ver. */
.banner .hint { color: inherit; opacity: .78; }
.banner button.action { color: inherit; border-color: currentColor; }
.banner button.action:hover:not(:disabled) { background: var(--bg-hover); color: var(--text); }
/* El recomendado se levanta sobre la superficie del panel: contrasta contra cualquiera de los
   tres fondos de banner sin necesidad de un color propio por tono. */
.banner button.action[data-primary="true"] {
  background: var(--bg); color: var(--text); border-color: transparent;
}
.banner button.action[data-primary="true"]:hover:not(:disabled) { background: var(--bg-raised); }
/* Un .controls anidado ya trae su propio margen desde arriba. */
.banner .controls button { margin-top: 0; }

.now { display: flex; gap: 12px; align-items: center; }
.now img { width: 48px; height: 48px; border-radius: 8px; object-fit: cover; background: var(--bg-raised); flex: none; }
.now-meta { min-width: 0; flex: 1; }
.now-title { font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
/* Con la atribución, esta línea se alarga: que recorte en vez de desbordar el panel. */
.now-sub {
  color: var(--text-faint); font-size: 12px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.empty { color: var(--text-faint); font-size: 13px; }

/* Barra de progreso: además de mostrar, permite saltar a cualquier punto desde el propio Meet. */
.progress {
  height: 16px; display: flex; align-items: center; cursor: pointer; border: 0; padding: 0;
  width: 100%; background: none;
}
.progress .track { height: 4px; width: 100%; background: var(--bg-hover); border-radius: 100px; overflow: hidden; }
.progress .fill { display: block; height: 100%; background: var(--accent); border-radius: 100px; }
.progress:hover .track { height: 6px; }
.progress:disabled { cursor: default; }

.controls { display: flex; gap: 8px; }

/* Botones tipo píldora, que es la forma que usa Meet en toda su interfaz nueva. */
button.action {
  flex: 1; padding: 10px 20px; border-radius: 100px; border: 1px solid var(--border);
  background: transparent; color: var(--accent); cursor: pointer; font-size: 14px; font-weight: 500;
}
button.action:hover:not(:disabled) { background: var(--bg-hover); }
button.action:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }
button.action:disabled { opacity: .38; cursor: default; }
button.action[data-primary="true"] {
  background: var(--accent); border-color: transparent; color: var(--accent-text);
}
button.action[data-primary="true"]:hover:not(:disabled) { background: var(--accent-hover); }

.section-title { font-size: 12px; font-weight: 500; color: var(--text-faint); }

.slider { display: grid; gap: 4px; }
.slider-head { display: flex; justify-content: space-between; font-size: 13px; }
.slider-head span:last-child { color: var(--text-faint); font-variant-numeric: tabular-nums; }
.slider input { width: 100%; accent-color: var(--accent); }
.slider[data-ducking="true"] .slider-head span:last-child::after { content: " · ducking"; color: var(--warn-text); }
.hint { color: var(--text-faint); font-size: 12px; line-height: 1.5; }
.hint[data-tone="warn"] { color: var(--warn-text); }

/* Volumen compartido: pasos discretos, no un slider. Cada toque es un pedido, no un ajuste fino. */
.stepper { display: flex; align-items: center; gap: 10px; }
.stepper .level {
  flex: 1; text-align: center; font-size: 15px; font-variant-numeric: tabular-nums;
  color: var(--text);
}
.stepper button.action { flex: none; width: 52px; padding: 9px 0; }
.stepper button.action svg {
  width: 20px; height: 20px; display: block; margin: 0 auto; fill: currentColor;
}

.row { display: flex; gap: 8px; }
.row input[type="text"], .row select {
  flex: 1; min-width: 0; padding: 10px 14px; border-radius: 8px;
  border: 1px solid var(--border); background: transparent; color: var(--text); font-size: 14px;
}
.row input[type="text"]::placeholder { color: var(--text-faint); }
.row input[type="text"]:focus, .row select:focus { outline: none; border-color: var(--accent); }

ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
li { display: flex; gap: 10px; align-items: center; padding: 8px; border-radius: 8px; }
li:hover { background: var(--bg-raised); }
li .title { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 13px; }
li .by { color: var(--text-faint); font-size: 12px; }
li .dur { color: var(--text-faint); font-size: 12px; font-variant-numeric: tabular-nums; }
li img { width: 32px; height: 32px; border-radius: 6px; object-fit: cover; flex: none; background: var(--bg-raised); }

.toggle { display: flex; align-items: flex-start; gap: 10px; font-size: 13px; cursor: pointer; }
.toggle input { accent-color: var(--accent); margin-top: 2px; flex: none; }

/* Estado inicial: lo único que hay que entender antes de pegar el primer link. */
.stage { display: grid; gap: 6px; }
.stage-title { font-size: 15px; font-weight: 500; }

/*
 * Grupo de controles apoyado sobre una superficie hundida. Separa "las perillas" del resto sin
 * un borde duro, que es como Meet agrupa dentro de sus propios paneles.
 */
.group { background: var(--bg-sunken); border-radius: 12px; padding: 14px; display: grid; gap: 10px; }

/* El pie: estado del canal y la salida. Separado por una línea porque no es parte del flujo. */
.footer { border-top: 1px solid var(--border); padding-top: 12px; display: grid; gap: 10px; }

.settings { display: grid; gap: 14px; }
.about { border-top: 1px solid var(--border); padding-top: 12px; font-size: 12px; color: var(--text-faint); }
.about a { color: var(--accent); }

/* Botón cuadrado de sólo ícono dentro de una fila de formulario: el "+" de agregar. */
button.action[data-icon="true"] { flex: none; width: 46px; padding: 0; }
button.action[data-icon="true"] svg { width: 22px; height: 22px; display: block; margin: 0 auto; fill: currentColor; }

/*
 * Acción destructiva y de baja frecuencia. Sin borde ni acento: tiene que ser encontrable, no
 * llamativa — la aprieta cualquiera y corta la música de toda la reunión.
 */
button.action[data-quiet="true"] { border-color: transparent; color: var(--text-dim); font-weight: 400; }
button.action[data-quiet="true"]:hover:not(:disabled) { background: var(--bg-hover); color: var(--text); }

/* Los botones de cada fila de la cola: más chicos que los de cabecera, la fila mide 32px. */
li .icon-btn { width: 32px; height: 32px; flex: none; }
li .icon-btn svg { width: 18px; height: 18px; display: block; fill: currentColor; }

/*
 * Un link pegado tarda en resolver su título. Es el único giro de la interfaz, y está porque el
 * silencio de ese segundo se lee como que la extensión no anduvo.
 */
.spinner {
  width: 16px; height: 16px; border-radius: 50%; display: inline-block; flex: none;
  border: 2px solid currentColor; border-right-color: transparent;
  vertical-align: -3px; margin-right: 6px;
  animation: mm-spin .7s linear infinite;
}
button.action[data-icon="true"] .spinner { margin: 0 auto; }
@keyframes mm-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spinner { animation-duration: 2.4s; } }
`
