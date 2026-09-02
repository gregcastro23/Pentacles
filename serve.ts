import { join } from "path";

// Serves the PRODUCTION Vite build (run `npm run build` first → ./dist).
// For local development use `npm run dev` (the Vite dev server with HMR) instead.
const root = join(import.meta.dir, "dist");
// Port: $PORT, or a CLI arg (`bun serve.ts 8090`), else 8080.
const port = Number(process.env.PORT || Bun.argv[2] || 8080);

console.log(`Serving Pentacles build from ${root} at http://localhost:${port}`);
console.log(`(If you see 404s, run \`npm run build\` first.)`);

Bun.serve({
  port,
  async fetch(req) {
    const url = new URL(req.url);
    let path = url.pathname;

    // Default route → the playable web client. The design doc stays reachable at
    // /Pentacles_GDD.html (copied into the build from public/).
    if (path === "/" || path === "/index.html") path = "/index.html";

    const file = Bun.file(join(root, path));
    if (await file.exists()) return new Response(file);

    // SPA fallback: extension-less unknown routes serve the app shell.
    if (!path.split("/").pop()?.includes(".")) {
      return new Response(Bun.file(join(root, "index.html")));
    }
    return new Response(`File not found: ${path}`, { status: 404 });
  },
});
