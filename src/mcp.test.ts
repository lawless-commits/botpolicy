import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it } from "vitest";
import { startSite, type FixtureSite } from "../fixtures/server.mjs";
import { run } from "./cli.js";
import { createMcpServer, type McpDeps } from "./mcp.js";
import { createFetcher } from "./net/fetcher.js";

let site: FixtureSite | null = null;
let client: Client | null = null;
afterEach(async () => {
  await client?.close();
  await site?.close();
  client = null;
  site = null;
});

const NOW = new Date("2026-11-14T12:00:00Z");

async function connect(deps: Partial<McpDeps> = {}) {
  const server = createMcpServer({ now: () => NOW, ...deps });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(clientTransport);
  return client;
}

async function serve(name: string) {
  site = await startSite(fileURLToPath(new URL(`../fixtures/sites/${name}`, import.meta.url)));
  const port = site.port;
  return () => createFetcher({ userAgent: "t", checkAddress: (ip, p) => ip === "127.0.0.1" && p === port });
}

const text = (result: Awaited<ReturnType<Client["callTool"]>>) =>
  (result.content as { type: string; text: string }[]).find((c) => c.type === "text")!.text;

describe("MCP server", () => {
  it("lists the five tools, all read-only", async () => {
    const { tools } = await (await connect()).listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["audit_site", "check_policy", "draft_robots_rules", "explain_verdict", "list_bots"]);
    for (const tool of tools) {
      expect(tool.annotations?.readOnlyHint, tool.name).toBe(true);
      expect(tool.annotations?.destructiveHint, tool.name).toBe(false);
    }
  });

  it("audit_site returns exactly the CLI's JSON for the same input", async () => {
    const makeFetcher = await serve("blocked-robots");
    const c = await connect({ makeFetcher });
    const viaMcp = await c.callTool({ name: "audit_site", arguments: { url: site!.url, paths: ["/"] } });
    const viaCli = await run(["audit", site!.url, "--json"], { fetcher: makeFetcher(), now: () => NOW });
    expect(JSON.parse(text(viaMcp))).toEqual(JSON.parse(viaCli.stdout));
    expect(viaMcp.structuredContent).toEqual(JSON.parse(viaCli.stdout));
  });

  it("check_policy takes the policy inline and returns the CLI's JSON", async () => {
    const makeFetcher = await serve("clean");
    const policyPath = fileURLToPath(new URL("../fixtures/policies/search-in-training-out.json", import.meta.url));
    const policy = JSON.parse(readFileSync(policyPath, "utf8"));
    const c = await connect({ makeFetcher });
    const viaMcp = await c.callTool({ name: "check_policy", arguments: { policy, url: site!.url } });
    const viaCli = await run(["test", site!.url, "--policy", policyPath, "--json"], { fetcher: makeFetcher(), now: () => NOW });
    const mcpReport = JSON.parse(text(viaMcp));
    const cliReport = JSON.parse(viaCli.stdout);
    expect({ ...mcpReport, policy: { ...mcpReport.policy, file: "" } }).toEqual({ ...cliReport, policy: { ...cliReport.policy, file: "" } });
    expect(mcpReport.policy.status).toBe("fail");
  });

  it("check_policy reports an invalid policy as a tool error", async () => {
    const c = await connect();
    const result = await c.callTool({ name: "check_policy", arguments: { policy: { site: "https://e.com", paths: ["/"], rules: [{ bots: ["Nope"], expect: "blocked" }] } } });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("unknown crawler 'Nope'");
  });

  it("explain_verdict explains one crawler on one path", async () => {
    const makeFetcher = await serve("blocked-robots");
    const c = await connect({ makeFetcher });
    const result = await c.callTool({ name: "explain_verdict", arguments: { url: site!.url, bot: "gptbot", path: "/" } });
    const out = JSON.parse(text(result));
    expect(out.verdict).toMatchObject({ token: "GPTBot", verdict: "blocked", decidedBy: "robots", robots: { line: 2 } });
    expect(out.explanation).toContain("robots.txt line 2: Disallow: /");
    expect(out.bot.docsUrl).toBe("https://developers.openai.com/api/docs/bots");
  });

  it("list_bots returns the registry", async () => {
    const result = await (await connect()).callTool({ name: "list_bots", arguments: {} });
    const viaCli = await run(["bots", "--json"]);
    expect(JSON.parse(text(result))).toEqual(JSON.parse(viaCli.stdout));
  });

  it("draft_robots_rules returns text and writes nothing", async () => {
    const result = await (await connect()).callTool({
      name: "draft_robots_rules",
      arguments: { block: "purpose:training", allow: "purpose:search" },
    });
    const rules = text(result);
    expect(rules).toMatch(/User-agent: GPTBot\n[\s\S]*Disallow: \//);
    expect(rules).toMatch(/User-agent: Google-Extended/);
    expect(rules).toMatch(/User-agent: OAI-SearchBot\n[\s\S]*Allow: \//);
    expect(rules).not.toMatch(/User-agent: ChatGPT-User/);
  });

  it("refuses a private address through MCP too", async () => {
    const c = await connect(); // production fetcher: public addresses only
    const result = await c.callTool({ name: "audit_site", arguments: { url: "http://169.254.169.254/" } });
    const report = JSON.parse(text(result));
    expect(report.robots.status).toBe("not-measured");
    expect(report.findings[0].message).toMatch(/refused-address|not a public address/);
  });

  it("offers no probe: extra arguments do not turn one on", async () => {
    const makeFetcher = await serve("clean");
    const c = await connect({ makeFetcher });
    const result = await c.callTool({ name: "audit_site", arguments: { url: site!.url, probe: true } });
    expect(JSON.parse(text(result)).probe).toBeUndefined();
    expect(new Set(site!.requests.map((r) => r.userAgent))).toEqual(new Set(["t"]));
  });
});
