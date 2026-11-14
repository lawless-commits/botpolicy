import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFetcher } from "./net/fetcher.js";
import { runRobots } from "./runner.js";

let server: Server;
let port: number;
let respond: (res: ServerResponse, url: string) => void = (res) => res.end();

beforeAll(async () => {
  server = createServer((req, res) => respond(res, req.url ?? ""));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

const fetcher = () => createFetcher({ userAgent: "t", checkAddress: (ip, p) => ip === "127.0.0.1" && p === port });

describe("runRobots over the network", () => {
  it("fetches /robots.txt from the site root, whatever path was given", async () => {
    let asked = "";
    respond = (res, url) => {
      asked = url;
      res.writeHead(200, { "content-type": "text/plain" }).end("User-agent: *\nDisallow: /\n");
    };
    const report = await runRobots(`http://127.0.0.1:${port}/some/page`, ["/"], { fetcher: fetcher() });
    expect(asked).toBe("/robots.txt");
    expect(report.status).toBe("parsed");
    expect(report.verdicts.find((v) => v.token === "GPTBot")!.verdict).toBe("blocked");
  });

  it("reports a 503 as not measured", async () => {
    respond = (res) => res.writeHead(503).end();
    const report = await runRobots(`http://127.0.0.1:${port}/`, ["/"], { fetcher: fetcher() });
    expect(report.status).toBe("not-measured");
  });

  it("reports a 404 as absent with everything allowed", async () => {
    respond = (res) => res.writeHead(404).end();
    const report = await runRobots(`http://127.0.0.1:${port}/`, ["/"], { fetcher: fetcher() });
    expect(report.status).toBe("absent");
    expect(report.verdicts.every((v) => v.verdict === "allowed")).toBe(true);
  });
});
