import { defineConfig } from 'vite'

// Pentacles is a desktop-first, single-page client. The celestial data + math
// (star-catalog.js, constellations.js, sky.js), the legacy game logic (client.js)
// and the extracted UI bindings (app.js) load from `public/` as CLASSIC scripts so
// the existing inline-onclick handlers stay global and behavior is byte-identical.
// New work (toasts, a11y, web3, the live SpacetimeDB connection) lives under `src/`
// as real ES modules bundled by Vite and bridged onto `window`.
export default defineConfig({
  server: { port: Number(process.env.PORT) || 5173, open: false, host: true },
  preview: { port: 4173 },
  build: {
    target: 'es2022',
    outDir: 'dist',
    sourcemap: true,
  },
})
