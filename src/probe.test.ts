import { afterEach, describe, expect, it } from "vitest";
import { startEdgeSite, type EdgeSite } from "../fixtures/edge-server.mjs";
import { run } from "./cli.js";
import { auditText } from "./core/report/format.js";
import { ReportSchema, type Report } from "./core/report/schema.js";
import { BOTS } from "./core/registry.js";
import { createFetcher } from "./net/fetcher.js";
import { InputError, runAudit } from "./runner.js";

let site: EdgeSite | null = null;
afterEach(async () => {
  await site?.close();
  site = null;
});

const sleeps: number[] = [];
async function probe(options: { bots?: string[]; paths?: string[]; sleep?: (ms: number) => Promise<void>; budget?: number } = {}) {
  site = await startEdgeSite();
  const port = site.port;
  const fetcher = createFetcher({ userAgent: "botpolicy-test", budget: options.budget, checkAddress: (ip, p) => ip === "127.0.0.1" && p === port });
  sleeps.length = 0;
  const report = await runAudit(site.url, options.paths ?? ["/"], { fetcher }, {
    version: "0.0.0",
    probe: true,
    probeBots: options.bots,
    sleep: options.sleep ?? (async (ms) => void sleeps.push(ms)),
  });
  ReportSchema.parse(report);
  return { report, fetcher };
}
const v = (r: Report, token: string) => r.verdicts.find((x) => x.token === token && x.path === "/")!;

describe("probe classifier on the local edge server", () => {
  it("classifies refused, challenged, altered and served responses", async () => {
    const { report } = await probe();
    expect(v(report, "GPTBot").edge).toMatchObject({ class: "denied", status: 403, simulated: true });
    expect(v(report, "PerplexityBot").edge).toMatchObject({ class: "challenged", simulated: true });
    expect(v(report, "OAI-SearchBot").edge).toMatchObject({ class: "different" });
    expect(v(report, "CCBot").edge).toMatchObject({ class: "different" });
    expect(v(report, "Googlebot").edge).toMatchObject({ class: "served" });
  });

  it("turns a refusal at the edge into a blocked verdict decided by the edge", async () => {
    const { report } = await probe();
    expect(v(report, "GPTBot")).toMatchObject({ verdict: "blocked", decidedBy: "edge" });
    expect(v(report, "PerplexityBot")).toMatchObject({ verdict: "blocked", decidedBy: "edge" });
    expect(report.findings.some((f) => f.check === "E1" && f.bots.includes("GPTBot") && f.severity === "warning")).toBe(true);
  });

  it("notes a robots.txt block the edge does not enforce", async () => {
    const { report } = await probe();
    const meta = v(report, "Meta-ExternalAgent");
    expect(meta).toMatchObject({ verdict: "blocked", decidedBy: "robots", edge: { class: "served" } });
    expect(meta.notes.join(" ")).toMatch(/served it the page \(simulated\)/);
  });

  it("never probes control tokens or crawlers with no published user agent, and says so", async () => {
    const { report } = await probe();
    expect(v(report, "Google-Extended").edge).toBeNull();
    expect(v(report, "ClaudeBot").edge).toBeNull();
    expect(v(report, "ClaudeBot").notes.join(" ")).toMatch(/not probed/i);
    const uas = site!.requests.map((r) => r.userAgent);
    expect(uas.some((ua) => /Google-Extended|Applebot-Extended/.test(ua))).toBe(false);
  });

  it("labels the run and every edge result as simulated, in JSON and text", async () => {
    const { report } = await probe();
    expect(report.probe).toMatchObject({ enabled: true, simulated: true });
    expect(report.verdicts.filter((x) => x.edge).every((x) => x.edge!.simulated)).toBe(true);
    const text = auditText(report, BOTS);
    expect(text).toMatch(/Probe: SIMULATED/);
    expect(text).toMatch(/GPTBot\s+training\s+BLOCKED\s+edge: HTTP 403 \(simulated\)/);
  });
});

describe("probe manners", () => {
  it("waits one second before each probe request", async () => {
    const { report } = await probe();
    const probes = report.verdicts.filter((x) => x.edge !== null).length;
    expect(sleeps).toEqual(Array(probes).fill(1000));
  });

  it("really spaces probe requests a second apart", async () => {
    await probe({ bots: ["GPTBot", "Googlebot"], sleep: (ms) => new Promise((r) => setTimeout(r, ms)) });
    const times = site!.requests.filter((r) => r.userAgent !== "botpolicy-test").map((r) => r.at);
    expect(times).toHaveLength(2);
    expect(times[1]! - times[0]!).toBeGreaterThanOrEqual(950);
  }, 10_000);

  it("only probes the crawlers asked for", async () => {
    const { report } = await probe({ bots: ["GPTBot"] });
    expect(report.verdicts.filter((x) => x.edge !== null).map((x) => x.token)).toEqual(["GPTBot"]);
  });

  it("refuses before sending anything when the plan is over budget", async () => {
    site = await startEdgeSite();
    const port = site.port;
    const fetcher = createFetcher({ userAgent: "t", checkAddress: (ip, p) => ip === "127.0.0.1" && p === port });
    const plan = runAudit(site.url, ["/", "/a", "/b"], { fetcher }, { version: "0", probe: true, sleep: async () => {} });
    await expect(plan).rejects.toThrow(InputError);
    await expect(plan).rejects.toThrow(/--bots|fewer paths/);
    expect(site.requests).toHaveLength(0);
  });

  it("never sends more requests than the budget, whatever the plan", async () => {
    const { fetcher, report } = await probe({ paths: ["/", "/x"] });
    expect(fetcher.used()).toBeLessThanOrEqual(fetcher.limits.budget);
    expect(site!.requests.length).toBe(report.requests);
  });

  it("sends no crawler user agent without --probe", async () => {
    site = await startEdgeSite();
    const port = site.port;
    const fetcher = createFetcher({ userAgent: "botpolicy-test", checkAddress: (ip, p) => ip === "127.0.0.1" && p === port });
    await runAudit(site.url, ["/"], { fetcher }, { version: "0" });
    expect(new Set(site.requests.map((r) => r.userAgent))).toEqual(new Set(["botpolicy-test"]));
  });

  it("exits 2 from the CLI when --bots names an unknown crawler", async () => {
    expect((await run(["audit", "https://example.com", "--probe", "--bots", "Nope"])).code).toBe(2);
  });
});
