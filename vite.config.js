import { defineConfig, loadEnv } from 'vite'

function legacyRedirectsMiddleware() {
  return (req, res, next) => {
    const path = (req.url || '').split('?')[0]
    if (path === '/manifold.html' || path === '/singularity.html') {
      res.statusCode = 302
      res.setHeader('location', '/')
      res.end()
      return
    }
    next()
  }
}

function redirectsPlugin() {
  return {
    name: 'pentacles-redirects',
    configureServer(server) {
      server.middlewares.use(legacyRedirectsMiddleware())
    },
    configurePreviewServer(server) {
      server.middlewares.use(legacyRedirectsMiddleware())
    },
  }
}

// Pentacles is a desktop-first, single-page client. The celestial data + math
// (star-catalog.js, constellations.js, sky.js), the legacy game logic (client.js)
// and the extracted UI bindings (app.js) load from `public/` as CLASSIC scripts so
// the existing inline-onclick handlers stay global and behavior is byte-identical.
// New work (toasts, a11y, web3, the live SpacetimeDB connection) lives under `src/`
// as real ES modules bundled by Vite and bridged onto `window`.
export default defineConfig(({ mode }) => {
  Object.assign(process.env, loadEnv(mode, process.cwd(), ''))
  return {
    define: {
      global: 'globalThis',
    },
    plugins: [redirectsPlugin()],
    server: { port: Number(process.env.PORT) || 5173, open: false, host: true },
    preview: { port: 4173 },
    build: {
      target: 'es2022',
      outDir: 'dist',
      sourcemap: process.env.VITE_SOURCEMAPS === 'true',
      chunkSizeWarningLimit: 700,
      rollupOptions: {
        input: {
          main: 'index.html',
          observatory: 'observatory.html',
        },
        output: {
          manualChunks(id) {
            if (id.includes('node_modules/three')) {
              return 'three'
            }
          },
        },
      },
    },
  }
})
