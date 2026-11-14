import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { startSite, type FixtureSite } from "../fixtures/server.mjs";
import { policyJsonSchema } from "./core/policy/schema.js";
import { reportJsonSchema, ReportSchema, type Report } from "./core/report/schema.js";
import { createFetcher } from "./net/fetcher.js";
import { InputError, runAudit } from "./runner.js";

let site: FixtureSite | null = null;
afterEach(async () => {
  await site?.close();
  site = null;
});

async function audit(name: string, paths = ["/"]): Promise<Report> {
  site = await startSite(fileURLToPath(new URL(`../fixtures/sites/${name}`, import.meta.url)));
  const port = site.port;
  const fetcher = createFetcher({ userAgent: "botpolicy-test", checkAddress: (ip, p) => ip === "127.0.0.1" && p === port });
  const report = await runAudit(site.url, paths, { fetcher }, { version: "0.0.0", now: () => new Date("2026-11-14T12:00:00Z") });
  ReportSchema.parse(report);
  return report;
}
const verdict = (r: Report, token: string, path = "/") => r.verdicts.find((v) => v.token === token && v.path === path)!;
const problems = (r: Report) => r.findings.filter((f) => f.severity !== "info");

describe("audit on the five fixture sites", () => {
  it("clean: everything allowed, no warnings, sitemap reachable", async () => {
    const r = await audit("clean");
    expect(problems(r)).toEqual([]);
    expect(r.verdicts.every((v) => v.verdict === "allowed")).toBe(true);
    expect(r.findings.find((f) => f.check === "R7")!.message).toMatch(/reachable/);
    expect(r.pages[0]).toMatchObject({ status: 200, jsonLd: [{ valid: true, types: ["Organization"] }] });
    expect(r.requests).toBe(4);
  });

  it("blocked in robots.txt: GPTBot and ClaudeBot blocked with their lines", async () => {
    const r = await audit("blocked-robots");
    expect(verdict(r, "GPTBot")).toMatchObject({ verdict: "blocked", decidedBy: "robots", robots: { line: 2 } });
    expect(verdict(r, "ClaudeBot")).toMatchObject({ verdict: "blocked", robots: { line: 5 } });
    expect(verdict(r, "OAI-SearchBot").verdict).toBe("allowed");
  });

  it("noindex header: documented crawlers restricted, others allowed with a note", async () => {
    const r = await audit("noindex-header");
    expect(verdict(r, "Googlebot")).toMatchObject({ verdict: "restricted", decidedBy: "page", pageControls: ["noindex"] });
    expect(verdict(r, "Applebot").verdict).toBe("restricted");
    expect(verdict(r, "GPTBot").verdict).toBe("allowed");
    expect(verdict(r, "GPTBot").notes.join(" ")).toMatch(/noindex/);
    expect(r.findings.some((f) => f.check === "P1" && f.severity === "warning")).toBe(true);
  });

  it("empty JavaScript shell: P4 warning with no readable text", async () => {
    const r = await audit("js-shell");
    expect(r.pages[0]!.textLength).toBe(0);
    expect(r.findings.find((f) => f.check === "P4")).toMatchObject({ severity: "warning", evidence: { level: "measured" } });
  });

  it("CDN-managed robots.txt: training crawlers blocked by the managed block", async () => {
    const r = await audit("cdn-managed", ["/", "/admin/x"]);
    expect(verdict(r, "GPTBot").robots.managed).toBe("Cloudflare Managed content");
    expect(verdict(r, "GPTBot").verdict).toBe("blocked");
    expect(verdict(r, "OAI-SearchBot", "/admin/x")).toMatchObject({ verdict: "blocked", robots: { line: 35 } });
    expect(r.findings.some((f) => f.check === "R6" && /Cloudflare Managed content/.test(f.message))).toBe(true);
    expect(r.robots.contentSignals[0]!.values).toEqual({ search: "yes", "ai-train": "no" });
  });
});

describe("audit manners and limits", () => {
  it("sends only the tool's own user agent, one request per path", async () => {
    await audit("clean", ["/", "/missing"]);
    expect(site!.requests.map((q) => q.path)).toEqual(["/robots.txt", "/", "/missing", "/sitemap.xml", "/llms.txt"]);
    expect(new Set(site!.requests.map((q) => q.userAgent))).toEqual(new Set(["botpolicy-test"]));
  });

  it("marks a missing page not measured for every crawler robots.txt allows", async () => {
    const r = await audit("blocked-robots", ["/missing"]);
    expect(verdict(r, "OAI-SearchBot", "/missing")).toMatchObject({ verdict: "not-measured", decidedBy: "page" });
    expect(verdict(r, "GPTBot", "/missing").verdict).toBe("blocked");
  });

  it("refuses before sending anything when the plan is over budget", async () => {
    const fetcher = createFetcher({ userAgent: "t", budget: 4 });
    await expect(runAudit("https://example.com", ["/a", "/b"], { fetcher }, { version: "0" })).rejects.toThrow(InputError);
    expect(fetcher.used()).toBe(0);
  });

  it("counts unproven checks as carrying no weight", async () => {
    const r = await audit("clean");
    expect(r.findings.find((f) => f.check === "I1")!.evidence).toMatchObject({ level: "unproven", weight: false });
  });
});

describe("report schema", () => {
  it("matches the committed schema/report.json", () => {
    const committed = JSON.parse(readFileSync(new URL("../schema/report.json", import.meta.url), "utf8"));
    expect(committed).toEqual(JSON.parse(JSON.stringify(reportJsonSchema())));
  });

  it("matches the committed schema/policy.json", () => {
    const committed = JSON.parse(readFileSync(new URL("../schema/policy.json", import.meta.url), "utf8"));
    expect(committed).toEqual(JSON.parse(JSON.stringify(policyJsonSchema())));
  });
});
