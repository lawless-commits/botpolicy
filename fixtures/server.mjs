// Local test server for fixture sites. Serves files from one site directory.
// "{{origin}}" in text files is replaced with the server's own origin.
// An optional headers.json maps a path to { "status": 200, "headers": { ... } }.
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { URL } from "node:url";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml",
  ".json": "application/json",
};

export async function startSite(dir) {
  let overrides = {};
  try {
    overrides = JSON.parse(await readFile(join(dir, "headers.json"), "utf8"));
  } catch {
    // no overrides
  }
  const requests = [];
  const server = createServer(async (req, res) => {
    const path = new URL(req.url ?? "/", "http://x").pathname;
    requests.push({ path, userAgent: req.headers["user-agent"] ?? "" });
    const file = path.endsWith("/") ? `${path}index.html` : path;
    const safe = normalize(file).replace(/^(\.\.[/\\])+/, "");
    const extra = overrides[path] ?? {};
    try {
      if (safe === "/headers.json") throw new Error("hidden");
      let body = await readFile(join(dir, safe), "utf8");
      body = body.replaceAll("{{origin}}", `http://127.0.0.1:${server.address().port}`);
      res.writeHead(extra.status ?? 200, { "content-type": TYPES[extname(safe)] ?? "application/octet-stream", ...(extra.headers ?? {}) });
      res.end(body);
    } catch {
      res.writeHead(404, { "content-type": "text/plain" }).end("not found");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  return {
    port,
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise((resolve) => {
      server.closeAllConnections();
      server.close(resolve);
    }),
  };
}
