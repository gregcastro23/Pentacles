import { defineConfig } from 'vite'

// Standalone library build for the embeddable AlchmChart module, so other
// "alchm" projects can `npm i` / script-tag it independently of the Pentacles
// app bundle. The app's own `vite build` (vite.config.js) is untouched.
//   npm run build:chart  →  dist-alchm/alchm-chart.{js,umd.cjs} + alchm-chart.css
export default defineConfig({
  define: {
    global: 'globalThis',
  },
  publicDir: false, // don't copy public/ into the library output
  build: {
    outDir: 'dist-alchm',
    emptyOutDir: true,
    sourcemap: true,
    cssCodeSplit: false,
    lib: {
      entry: 'src/alchm-chart/lib-entry.js',
      name: 'AlchmChart',
      formats: ['es', 'umd'],
      fileName: (fmt) => `alchm-chart.${fmt === 'umd' ? 'umd.cjs' : 'js'}`,
      cssFileName: 'alchm-chart',
    },
    rollupOptions: { output: { exports: 'named' } },
  },
})
