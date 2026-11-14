import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { gzipSync } from "node:zlib";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createFetcher, type FetcherOptions } from "./fetcher.js";

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

let server: Server;
let port: number;
let base: string;
let hits: IncomingMessage[] = [];
const routes = new Map<string, Handler>();

beforeAll(async () => {
  server = createServer((req, res) => {
    hits.push(req);
    const handler = routes.get(req.url ?? "");
    if (handler) handler(req, res);
    else res.writeHead(404).end("not found");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  hits = [];
  routes.clear();
});

/** A fetcher that may reach the test server and nothing else on loopback. */
function testFetcher(options: Partial<FetcherOptions> = {}) {
  return createFetcher({
    userAgent: "botpolicy-test",
    checkAddress: (ip, p) => ip === "127.0.0.1" && p === port,
    ...options,
  });
}

function redirectChain(length: number) {
  for (let i = 0; i < length; i++) {
    routes.set(`/r${i}`, (_, res) => res.writeHead(302, { location: `/r${i + 1}` }).end());
  }
  routes.set(`/r${length}`, (_, res) => res.writeHead(200).end("end"));
}

describe("fetcher address checks", () => {
  it("refuses loopback by default and never connects", async () => {
    routes.set("/", (_, res) => res.end("hi"));
    const fetcher = createFetcher({ userAgent: "botpolicy-test" });
    const result = await fetcher.fetch(`${base}/`);
    expect(result).toMatchObject({ ok: false, error: "refused-address" });
    expect(hits).toHaveLength(0);
  });

  it.each(["http://10.0.0.1/", "http://[::1]/", "http://169.254.169.254/latest/meta-data/", "http://0x7f.1/", "http://2130706433/"])(
    "refuses %s by default",
    async (url) => {
      const result = await createFetcher({ userAgent: "t" }).fetch(url);
      expect(result).toMatchObject({ ok: false, error: "refused-address" });
    },
  );

  it("refuses a host when any resolved address is private", async () => {
    const fetcher = createFetcher({
      userAgent: "t",
      resolve: async () => [
        { address: "93.184.216.34", family: 4 },
        { address: "10.0.0.5", family: 4 },
      ],
    });
    expect(await fetcher.fetch("https://mixed.example/")).toMatchObject({
      ok: false,
      error: "refused-address",
    });
  });

  it("refuses a redirect to a private address", async () => {
    routes.set("/go", (_, res) => res.writeHead(302, { location: "http://10.1.2.3/secret" }).end());
    const result = await testFetcher().fetch(`${base}/go`);
    expect(result).toMatchObject({ ok: false, error: "refused-address" });
    expect(hits).toHaveLength(1);
  });

  it("refuses a redirect to loopback on another port", async () => {
    routes.set("/go", (_, res) =>
      res.writeHead(302, { location: `http://127.0.0.1:${port + 1}/` }).end(),
    );
    expect(await testFetcher().fetch(`${base}/go`)).toMatchObject({
      ok: false,
      error: "refused-address",
    });
  });

  it.each(["file:///etc/passwd", "ftp://example.com/", "not a url"])("rejects %s", async (url) => {
    expect(await testFetcher().fetch(url)).toMatchObject({ ok: false, error: "bad-url" });
  });

  it("rejects a redirect to a non-http scheme", async () => {
    routes.set("/go", (_, res) => res.writeHead(302, { location: "file:///etc/passwd" }).end());
    expect(await testFetcher().fetch(`${base}/go`)).toMatchObject({ ok: false, error: "bad-url" });
  });
});

describe("fetcher responses", () => {
  it("returns status, headers and body, and sends its user agent", async () => {
    routes.set("/robots.txt", (_, res) =>
      res.writeHead(200, { "content-type": "text/plain", "x-robots-tag": "noindex" }).end("User-agent: *\n"),
    );
    const result = await testFetcher().fetch(`${base}/robots.txt`);
    expect(result).toMatchObject({
      ok: true,
      status: 200,
      body: "User-agent: *\n",
      finalUrl: `${base}/robots.txt`,
      redirects: [],
    });
    if (result.ok) expect(result.headers["x-robots-tag"]).toBe("noindex");
    expect(hits[0]?.headers["user-agent"]).toBe("botpolicy-test");
  });

  it("returns non-2xx statuses as measured responses", async () => {
    routes.set("/err", (_, res) => res.writeHead(503).end("down"));
    expect(await testFetcher().fetch(`${base}/err`)).toMatchObject({ ok: true, status: 503 });
  });

  it("decompresses gzip", async () => {
    routes.set("/gz", (_, res) =>
      res.writeHead(200, { "content-encoding": "gzip" }).end(gzipSync("hello gzip")),
    );
    expect(await testFetcher().fetch(`${base}/gz`)).toMatchObject({ ok: true, body: "hello gzip" });
  });

  it("follows 5 redirects and records them", async () => {
    redirectChain(5);
    const result = await testFetcher().fetch(`${base}/r0`);
    expect(result).toMatchObject({ ok: true, status: 200, body: "end", finalUrl: `${base}/r5` });
    if (result.ok) expect(result.redirects).toHaveLength(5);
  });

  it("stops at the 6th redirect", async () => {
    redirectChain(6);
    expect(await testFetcher().fetch(`${base}/r0`)).toMatchObject({
      ok: false,
      error: "too-many-redirects",
    });
    expect(hits).toHaveLength(6);
  });
});

describe("fetcher limits", () => {
  it("refuses a body over 2 MB", async () => {
    routes.set("/big", (_, res) => res.writeHead(200).end(Buffer.alloc(2 * 1024 * 1024 + 1, 97)));
    expect(await testFetcher().fetch(`${base}/big`)).toMatchObject({ ok: false, error: "too-large" });
  });

  it("accepts a body of exactly 2 MB", async () => {
    routes.set("/edge", (_, res) => res.writeHead(200).end(Buffer.alloc(2 * 1024 * 1024, 97)));
    expect(await testFetcher().fetch(`${base}/edge`)).toMatchObject({ ok: true });
  });

  it("counts the 2 MB after decompression", async () => {
    const bomb = gzipSync(Buffer.alloc(20 * 1024 * 1024));
    expect(bomb.length).toBeLessThan(100 * 1024);
    routes.set("/bomb", (_, res) => res.writeHead(200, { "content-encoding": "gzip" }).end(bomb));
    expect(await testFetcher().fetch(`${base}/bomb`)).toMatchObject({ ok: false, error: "too-large" });
  });

  it("times out a server that never answers", async () => {
    routes.set("/slow", () => {});
    const started = Date.now();
    expect(await testFetcher({ timeoutMs: 200 }).fetch(`${base}/slow`)).toMatchObject({
      ok: false,
      error: "timeout",
    });
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("times out a body that trickles in", async () => {
    routes.set("/trickle", (_, res) => {
      res.writeHead(200);
      res.write("a");
    });
    expect(await testFetcher({ timeoutMs: 200 }).fetch(`${base}/trickle`)).toMatchObject({
      ok: false,
      error: "timeout",
    });
  });

  it("counts slow DNS against the deadline", async () => {
    const fetcher = createFetcher({ userAgent: "t", timeoutMs: 200, resolve: () => new Promise(() => {}) });
    expect(await fetcher.fetch("https://slow-dns.example/")).toMatchObject({ ok: false, error: "timeout" });
  });

  it("uses the default limits from the rules", () => {
    const f = createFetcher({ userAgent: "t" });
    expect(f.limits).toEqual({ timeoutMs: 10_000, maxBytes: 2 * 1024 * 1024, maxRedirects: 5, budget: 40 });
  });

  it("stops when the request budget is spent", async () => {
    routes.set("/", (_, res) => res.end("ok"));
    const fetcher = testFetcher({ budget: 2 });
    expect(await fetcher.fetch(`${base}/`)).toMatchObject({ ok: true });
    expect(await fetcher.fetch(`${base}/`)).toMatchObject({ ok: true });
    expect(await fetcher.fetch(`${base}/`)).toMatchObject({ ok: false, error: "budget-exhausted" });
    expect(hits).toHaveLength(2);
    expect(fetcher.used()).toBe(2);
  });

  it("counts each redirect hop against the budget", async () => {
    redirectChain(3);
    const fetcher = testFetcher({ budget: 3 });
    expect(await fetcher.fetch(`${base}/r0`)).toMatchObject({ ok: false, error: "budget-exhausted" });
    expect(hits).toHaveLength(3);
  });
});
