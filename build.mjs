import { build, context } from 'esbuild'
import { cpSync, mkdirSync, rmSync } from 'node:fs'

const watch = process.argv.includes('--watch')
const outdir = 'dist'

rmSync(outdir, { recursive: true, force: true })
mkdirSync(outdir, { recursive: true })

/**
 * Los content scripts de MV3 no pueden ser módulos ES, así que cada entrada se empaqueta como un
 * IIFE autocontenido. Usamos esbuild directo en vez de un plugin de bundler: menos magia y menos
 * cosas que se rompan entre versiones.
 */
const common = {
  bundle: true,
  format: 'iife',
  target: 'chrome116',
  platform: 'browser',
  jsx: 'automatic',
  jsxImportSource: 'preact',
  logLevel: 'info',
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
}

const entries = [
  { in: 'src/content/mic-patch.ts', out: 'mic-patch' },
  { in: 'src/content/panel.tsx', out: 'panel' },
  { in: 'src/background/service-worker.ts', out: 'service-worker' },
  { in: 'src/player/yt-content.ts', out: 'yt-content' },
  { in: 'src/player/yt-main.ts', out: 'yt-main' },
  { in: 'src/options/options.tsx', out: 'options' },
]

const copyStatic = () => cpSync('src/static', outdir, { recursive: true })

const config = {
  ...common,
  entryPoints: entries.map((e) => ({ in: e.in, out: e.out })),
  outdir,
}

if (watch) {
  const ctx = await context({
    ...config,
    plugins: [
      {
        name: 'copy-static',
        setup: (b) => b.onEnd(copyStatic),
      },
    ],
  })
  await ctx.watch()
  console.log('Observando cambios. Cargá dist/ en chrome://extensions y recargá tras cada build.')
} else {
  await build(config)
  copyStatic()
  console.log(`Listo. Cargá ${outdir}/ en chrome://extensions con el modo desarrollador activado.`)
}
