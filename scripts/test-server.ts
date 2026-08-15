// Scratch test server — serves the built app on a private port (3999) with an
// isolated DB so E2E testing never touches the live site (port 3000).
// Mirrors serve.ts: static client assets first, then the SSR/RPC handler.
import handler from "../dist/server/server.js";

const PORT = 3999;
const HOST = "127.0.0.1";
const CLIENT_DIR = `${import.meta.dir}/../dist/client`;

const server = Bun.serve({
  port: PORT,
  hostname: HOST,
  async fetch(req) {
    const { pathname } = new URL(req.url);
    if (pathname !== "/") {
      const file = Bun.file(CLIENT_DIR + pathname);
      if (await file.exists()) return new Response(file);
    }
    return (
      handler as { fetch: (r: Request) => Response | Promise<Response> }
    ).fetch(req);
  },
});
console.log(`test server on http://${HOST}:${PORT}`);
