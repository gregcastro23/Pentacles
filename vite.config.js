import { defineConfig, loadEnv } from 'vite'

function settlementMiddleware() {
  let handleBurnSettlement
  return async (req, res, next) => {
    if ((req.url || '').split('?')[0] !== '/api/web3/burn-esms') return next()
    try {
      const chunks = []
      let size = 0
      for await (const chunk of req) {
        size += chunk.length
        if (size > 65_536) {
          res.statusCode = 413
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify({ error: 'Request body is too large' }))
          return
        }
        chunks.push(chunk)
      }
      const headers = new Headers()
      for (const [name, value] of Object.entries(req.headers)) {
        if (value != null) headers.set(name, Array.isArray(value) ? value.join(', ') : value)
      }
      const request = new Request(
        new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`),
        {
          method: req.method,
          headers,
          body: ['GET', 'HEAD'].includes(req.method || '') ? undefined : Buffer.concat(chunks),
        },
      )
      if (!handleBurnSettlement) {
        ;({ handleBurnSettlement } = await import('./settlement/esms-redeemer.js'))
      }
      const response = await handleBurnSettlement(request)
      res.statusCode = response.status
      response.headers.forEach((value, name) => res.setHeader(name, value))
      res.end(Buffer.from(await response.arrayBuffer()))
    } catch (error) {
      next(error)
    }
  }
}

function settlementPlugin() {
  return {
    name: 'pentacles-esms-settlement',
    configureServer(server) {
      server.middlewares.use(settlementMiddleware())
    },
    configurePreviewServer(server) {
      server.middlewares.use(settlementMiddleware())
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
    plugins: [settlementPlugin()],
    server: { port: Number(process.env.PORT) || 5173, open: false, host: true },
    preview: { port: 4173 },
    build: {
      target: 'es2022',
      outDir: 'dist',
      sourcemap: true,
      rollupOptions: {
        input: {
          main: 'index.html',
          observatory: 'observatory.html',
        },
      },
    },
  }
})
