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
    
    // Default route
    if (path === "/" || path === "/index.html") {
      path = "/Pentacles_GDD.html";
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
