import { join } from "path";

const root = import.meta.dir;
const port = 8080;

console.log(`Starting static server at http://localhost:${port}`);
console.log(`Serving files from: ${root}`);

Bun.serve({
  port: port,
  async fetch(req) {
    const url = new URL(req.url);
    let path = url.pathname;
    
    // Default route → the playable web client (matches the Vercel rewrite in
    // vercel.json). The design doc stays reachable at /Pentacles_GDD.html.
    if (path === "/" || path === "/index.html") {
      path = "/client.html";
    }
    
    const filePath = join(root, path);
    const file = Bun.file(filePath);
    
    if (await file.exists()) {
      return new Response(file);
    } else {
      return new Response(`File not found: ${path}`, { status: 404 });
    }
  }
});
