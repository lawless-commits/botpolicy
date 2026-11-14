import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BOTS } from "../registry.js";
import { analyseRobots, type RobotsInput } from "./checks.js";

const fixture = (name: string) => readFileSync(new URL(`../../../fixtures/robots/${name}`, import.meta.url), "utf8");
const ok = (body: string, contentType = "text/plain"): RobotsInput => ({
  kind: "response",
  url: "https://example.com/robots.txt",
  finalUrl: "https://example.com/robots.txt",
  status: 200,
  contentType,
  body,
});
const status = (code: number): RobotsInput => ({ ...ok(""), status: code } as RobotsInput);
const verdictOf = (report: ReturnType<typeof analyseRobots>, token: string, path = "/") =>
  report.verdicts.find((v) => v.token === token && v.path === path)!;
const checks = (report: ReturnType<typeof analyseRobots>, id: string) => report.findings.filter((f) => f.check === id);

describe("R1: fetch status", () => {
  it("parses a 200", () => {
    const report = analyseRobots(ok("User-agent: *\nDisallow: /\n"), BOTS, ["/"]);
    expect(report.status).toBe("parsed");
    expect(verdictOf(report, "GPTBot")).toMatchObject({ verdict: "blocked", line: 2, ruleText: "Disallow: /" });
  });

  it("treats a 404 as no robots.txt: measured, everything allowed", () => {
    const report = analyseRobots(status(404), BOTS, ["/"]);
    expect(report.status).toBe("absent");
    expect(report.verdicts.every((v) => v.verdict === "allowed" && v.reason === "no-robots-txt")).toBe(true);
    expect(checks(report, "R1")).toEqual([expect.objectContaining({ severity: "info" })]);
  });

  it.each([401, 403])("treats a %s as allowed but warns that something may be blocking", (code) => {
    const report = analyseRobots(status(code), BOTS, ["/"]);
    expect(report.status).toBe("absent");
    expect(checks(report, "R1")).toEqual([expect.objectContaining({ severity: "warning" })]);
  });

  it.each([500, 503])("reports a %s as not measured, with the RFC note", (code) => {
    const report = analyseRobots(status(code), BOTS, ["/"]);
    expect(report.status).toBe("not-measured");
    expect(report.verdicts.every((v) => v.verdict === "not-measured")).toBe(true);
    expect(checks(report, "R1")[0]!.message).toMatch(/RFC 9309.*disallowed/);
  });

  it("reports an unreachable robots.txt as not measured", () => {
    const report = analyseRobots(
      { kind: "unreachable", url: "https://example.com/robots.txt", error: "timeout", message: "no response in 10000 ms" },
      BOTS,
      ["/"],
    );
    expect(report.status).toBe("not-measured");
    expect(report.verdicts.every((v) => v.verdict === "not-measured")).toBe(true);
    expect(checks(report, "R1")[0]).toMatchObject({ severity: "error" });
  });

  it("warns when a 200 serves HTML and parses it as empty", () => {
    const report = analyseRobots(ok("<!doctype html><html><body>Disallow: /</body></html>", "text/html; charset=utf-8"), BOTS, ["/"]);
    expect(report.status).toBe("parsed");
    expect(verdictOf(report, "GPTBot").verdict).toBe("allowed");
    expect(checks(report, "R1")).toEqual([expect.objectContaining({ severity: "warning" })]);
  });
});

describe("verdicts", () => {
  it("gives every registry token a verdict on every path", () => {
    const report = analyseRobots(ok(fixture("training-only.txt")), BOTS, ["/", "/blog/post"]);
    expect(report.verdicts).toHaveLength(BOTS.length * 2);
    expect(verdictOf(report, "GPTBot", "/blog/post")).toMatchObject({ verdict: "blocked", group: { kind: "named" } });
    expect(verdictOf(report, "OAI-SearchBot", "/blog/post")).toMatchObject({ verdict: "allowed", line: 6 });
  });

  it("notes that Amazon reads an unnamed Amzn-SearchBot differently", () => {
    const report = analyseRobots(ok("User-agent: *\nDisallow: /\n"), BOTS, ["/"]);
    expect(verdictOf(report, "Amzn-SearchBot").note).toMatch(/Amazon/);
    expect(verdictOf(report, "GPTBot").note).toBeUndefined();
  });
});

describe("R3: a named group drops * rules", () => {
  it("lists the lost rules for each named group", () => {
    const report = analyseRobots(ok(fixture("shadowing.txt")), BOTS, ["/"]);
    const found = checks(report, "R3");
    const gpt = found.find((f) => f.bots.includes("GPTBot"))!;
    expect(gpt.severity).toBe("warning");
    expect(gpt.lines).toEqual([2, 3, 4]);
    const search = found.find((f) => f.bots.includes("OAI-SearchBot"))!;
    expect(search.lines).toEqual([2, 4]);
  });

  it("stays quiet when the named group blocks everything anyway", () => {
    const report = analyseRobots(ok("User-agent: *\nDisallow: /a\n\nUser-agent: GPTBot\nDisallow: /\n"), BOTS, ["/"]);
    expect(checks(report, "R3")).toEqual([]);
  });
});

describe("R4: retired tokens", () => {
  it("reports rules for anthropic-ai and Claude-Web as unproven information", () => {
    const report = analyseRobots(ok(fixture("retired-tokens.txt")), BOTS, ["/"]);
    const found = checks(report, "R4");
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ severity: "info", lines: [1, 4] });
    expect(found[0]!.message).toMatch(/unproven/i);
  });
});

describe("R5: siblings treated differently", () => {
  it("flags a search crawler blocked by * when only its training sibling is named", () => {
    const report = analyseRobots(ok(fixture("training-only.txt")), BOTS, ["/"]);
    const found = checks(report, "R5");
    expect(found.some((f) => f.bots.includes("OAI-SearchBot") && f.severity === "warning")).toBe(true);
  });

  it("flags a search crawler blocked by name while its training sibling is allowed", () => {
    const report = analyseRobots(ok(fixture("retired-tokens.txt")), BOTS, ["/"]);
    const found = checks(report, "R5");
    expect(found.some((f) => f.bots.includes("OAI-SearchBot") && f.bots.includes("GPTBot"))).toBe(true);
  });

  it("stays quiet when * blocks only an area, such as /admin/, for everyone", () => {
    const report = analyseRobots(ok(fixture("cloudflare-managed.txt")), BOTS, ["/", "/admin/x"]);
    expect(checks(report, "R5")).toEqual([]);
  });

  it("gives one finding per crawler pair, listing the paths", () => {
    const report = analyseRobots(ok(fixture("training-only.txt")), BOTS, ["/", "/other"]);
    const pair = checks(report, "R5").filter((f) => f.bots[0] === "OAI-SearchBot" && f.bots[1] === "GPTBot");
    expect(pair).toHaveLength(1);
    expect(pair[0]!.message).toContain("Paths: /, /other.");
  });

  it("stays quiet when siblings are each named", () => {
    const robots = "User-agent: GPTBot\nDisallow: /\n\nUser-agent: OAI-SearchBot\nAllow: /\n\nUser-agent: ChatGPT-User\nAllow: /\n";
    const found = checks(analyseRobots(ok(robots), BOTS, ["/"]), "R5");
    expect(found.filter((f) => f.bots.includes("GPTBot"))).toEqual([]);
  });
});

describe("R6: CDN-managed blocks and content signals", () => {
  const report = analyseRobots(ok(fixture("cloudflare-managed.txt")), BOTS, ["/", "/admin/x"]);

  it("names the crawlers a managed block blocks", () => {
    const managed = checks(report, "R6").find((f) => f.message.includes("Cloudflare Managed content"))!;
    expect(managed.bots).toEqual(expect.arrayContaining(["GPTBot", "ClaudeBot", "CCBot"]));
    expect(managed.bots).not.toContain("OAI-SearchBot");
  });

  it("lists content signals", () => {
    expect(report.contentSignals).toEqual([{ line: 5, values: { search: "yes", "ai-train": "no" }, agents: ["*"] }]);
    expect(checks(report, "R6").some((f) => f.message.includes("ai-train=no"))).toBe(true);
  });

  it("merges the managed * group with the site's own * group", () => {
    expect(verdictOf(report, "OAI-SearchBot", "/admin/x")).toMatchObject({ verdict: "blocked", line: 35 });
  });

  it("keeps the sitemap", () => {
    expect(report.sitemaps).toEqual([{ url: "https://example.com/sitemap.xml", line: 36 }]);
  });
});
