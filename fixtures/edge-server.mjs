// Local test server that treats crawlers differently by user agent, like a CDN or bot manager.
//   GPTBot         403 Forbidden                         -> denied
//   PerplexityBot  503 Cloudflare-style challenge        -> challenged
//   OAI-SearchBot  200 with a different, short page      -> different
//   CCBot          302 to /blocked                       -> different (redirected)
//   everyone else  the real page                         -> served
// robots.txt disallows Meta-ExternalAgent, which the server still serves (robots not enforced).
import { createServer } from "node:http";
import { URL } from "node:url";

const PAGE = `<!doctype html><html><head><title>Edge Co</title></head><body>
<h1>Edge Co</h1>
<p>${"Edge Co sells weatherproof outdoor lighting and ships it across the country every weekday. ".repeat(8)}</p>
</body></html>`;
const ROBOTS = "User-agent: *\nAllow: /\n\nUser-agent: Meta-ExternalAgent\nDisallow: /\n";

export async function startEdgeSite() {
  const requests = [];
  const server = createServer((req, res) => {
    const ua = req.headers["user-agent"] ?? "";
    const path = new URL(req.url ?? "/", "http://x").pathname;
    requests.push({ path, userAgent: ua, at: Date.now() });
    if (path === "/robots.txt") return res.writeHead(200, { "content-type": "text/plain" }).end(ROBOTS);
    if (path === "/llms.txt" || path === "/sitemap.xml") return res.writeHead(404).end();
    if (path === "/blocked") return res.writeHead(200, { "content-type": "text/html" }).end("<html><head><title>Blocked</title></head><body>No.</body></html>");
    if (/GPTBot/.test(ua)) return res.writeHead(403, { "content-type": "text/plain" }).end("Forbidden");
    if (/PerplexityBot/.test(ua)) {
      return res
        .writeHead(503, { "content-type": "text/html", "cf-mitigated": "challenge" })
        .end("<html><head><title>Just a moment...</title></head><body><script src=/cdn-cgi/challenge-platform/h/b/orchestrate/jsch/v1></script></body></html>");
    }
    if (/OAI-SearchBot/.test(ua)) return res.writeHead(200, { "content-type": "text/html" }).end("<html><head><title>Edge Co</title></head><body><p>Please enable JavaScript.</p></body></html>");
    if (/CCBot/.test(ua)) return res.writeHead(302, { location: "/blocked" }).end();
    return res.writeHead(200, { "content-type": "text/html" }).end(PAGE);
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
