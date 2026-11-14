import { describe, expect, it } from "vitest";
import type { Report } from "../report/schema.js";
import { BOTS } from "../registry.js";
import { evaluatePolicy } from "./evaluate.js";
import { parsePolicy, type Policy } from "./schema.js";

type V = Report["verdicts"][number];
const verdict = (token: string, path: string, value: V["verdict"], line: number | null = null): V => ({
  token, path, verdict: value, decidedBy: value === "blocked" ? "robots" : value === "restricted" ? "page" : "none",
  robots: { verdict: value === "blocked" ? "blocked" : "allowed", line, ruleText: line ? "Disallow: /" : null, managed: null },
  pageControls: value === "restricted" ? ["noindex"] : [], edge: null, notes: [],
});
const report = (verdicts: V[], pages: Partial<Report["pages"][number]>[] = []): Pick<Report, "verdicts" | "pages"> => ({
  verdicts,
  pages: pages.map((p) => ({
    path: "/", url: "u", finalUrl: "u", status: 200, measured: true, isHtml: true, redirects: [], directives: [],
    dataNosnippetCount: 0, canonical: null, textLength: 1000, jsonLd: [], ...p,
  })),
});
const policy = (p: Partial<Policy>): Policy => parsePolicy({ site: "https://e.com", paths: ["/"], rules: [], ...p });

describe("evaluatePolicy", () => {
  it("passes when every expectation holds", () => {
    const result = evaluatePolicy(
      policy({ rules: [{ bots: ["GPTBot"], expect: "blocked" }, { bots: ["OAI-SearchBot"], expect: "allowed" }] }),
      report([verdict("GPTBot", "/", "blocked", 2), verdict("OAI-SearchBot", "/", "allowed")]),
      BOTS,
    );
    expect(result.status).toBe("pass");
    expect(result.checks).toHaveLength(2);
  });

  it("fails and names the deciding line", () => {
    const result = evaluatePolicy(
      policy({ rules: [{ bots: ["OAI-SearchBot"], expect: "allowed" }] }),
      report([verdict("OAI-SearchBot", "/", "blocked", 7)]),
      BOTS,
    );
    expect(result.status).toBe("fail");
    expect(result.checks[0]).toMatchObject({ ok: false, expected: "allowed", actual: "blocked" });
    expect(result.checks[0]!.reason).toContain("robots.txt line 7: Disallow: /");
  });

  it("expands purpose: and operator: selectors from the registry", () => {
    const result = evaluatePolicy(
      policy({ rules: [{ bots: "purpose:search", expect: "allowed" }, { bots: "operator:OpenAI", expect: "blocked" }] }),
      report(BOTS.map((b) => verdict(b.token, "/", "allowed"))),
      BOTS,
    );
    const tokens = result.checks.map((c) => c.token);
    expect(tokens).toContain("Googlebot");
    // OAI-SearchBot is search, but the later operator:OpenAI rule wins.
    expect(result.checks.find((c) => c.token === "OAI-SearchBot")).toMatchObject({ expected: "blocked", rule: 1 });
  });

  it("lets the last matching rule win, so exceptions follow general rules", () => {
    const result = evaluatePolicy(
      policy({
        paths: ["/", "/press/"],
        rules: [{ bots: "purpose:training", expect: "blocked" }, { bots: ["GPTBot"], paths: ["/press/"], expect: "allowed" }],
      }),
      report([verdict("GPTBot", "/", "blocked", 2), verdict("GPTBot", "/press/", "allowed")]),
      BOTS,
    );
    expect(result.status).toBe("pass");
    expect(result.checks.find((c) => c.path === "/press/" && c.token === "GPTBot")).toMatchObject({ expected: "allowed", rule: 1 });
  });

  it("treats restricted as not allowed, but as reachable", () => {
    const r = report([verdict("Googlebot", "/", "restricted")]);
    expect(evaluatePolicy(policy({ rules: [{ bots: ["Googlebot"], expect: "allowed" }] }), r, BOTS).status).toBe("fail");
    expect(evaluatePolicy(policy({ rules: [{ bots: ["Googlebot"], expect: "reachable" }] }), r, BOTS).status).toBe("pass");
    expect(evaluatePolicy(policy({ rules: [{ bots: ["Googlebot"], expect: "restricted" }] }), r, BOTS).status).toBe("pass");
  });

  it("never passes a not-measured verdict", () => {
    const result = evaluatePolicy(
      policy({ rules: [{ bots: ["GPTBot"], expect: "blocked" }] }),
      report([verdict("GPTBot", "/", "not-measured")]),
      BOTS,
    );
    expect(result.status).toBe("not-measured");
    expect(result.checks[0]).toMatchObject({ ok: null });
  });

  it("reports fail over not-measured when both happen", () => {
    const result = evaluatePolicy(
      policy({ rules: [{ bots: ["GPTBot", "ClaudeBot"], expect: "blocked" }] }),
      report([verdict("GPTBot", "/", "not-measured"), verdict("ClaudeBot", "/", "allowed")]),
      BOTS,
    );
    expect(result.status).toBe("fail");
  });

  it("checks page requirements: text without JavaScript and JSON-LD types", () => {
    const p = policy({ page: { minTextWithoutJs: 500, requireJsonLd: ["Product"] } });
    const failing = evaluatePolicy(p, report([], [{ textLength: 20, jsonLd: [{ index: 0, valid: true, types: ["Organization"] }] }]), BOTS);
    expect(failing.status).toBe("fail");
    expect(failing.pageChecks.map((c) => c.requirement)).toEqual(["minTextWithoutJs", "requireJsonLd"]);
    const passing = evaluatePolicy(p, report([], [{ textLength: 900, jsonLd: [{ index: 0, valid: true, types: ["Product"] }] }]), BOTS);
    expect(passing.status).toBe("pass");
  });

  it("treats an unmeasured page as not measured for page requirements", () => {
    const p = policy({ page: { minTextWithoutJs: 500 } });
    expect(evaluatePolicy(p, report([], [{ measured: false }]), BOTS).status).toBe("not-measured");
  });
});

describe("parsePolicy", () => {
  it("accepts the roadmap's example", () => {
    expect(() =>
      parsePolicy({
        $schema: "https://unpkg.com/botpolicy/schema/policy.json",
        site: "https://example.com",
        paths: ["/", "/blog/", "/products/sample"],
        rules: [
          { bots: "purpose:search", expect: "allowed" },
          { bots: "purpose:user-fetch", expect: "allowed" },
          { bots: "purpose:training", expect: "blocked" },
          { bots: ["GPTBot"], paths: ["/press/"], expect: "allowed" },
        ],
        page: { minTextWithoutJs: 500, requireJsonLd: ["Product"] },
      }),
    ).not.toThrow();
  });

  it.each([
    [{ site: "ftp://e.com", paths: ["/"], rules: [] }, /site/],
    [{ site: "https://e.com", paths: ["blog"], rules: [] }, /paths/],
    [{ site: "https://e.com", paths: ["/"], rules: [{ bots: ["NoSuchBot"], expect: "blocked" }] }, /NoSuchBot/],
    [{ site: "https://e.com", paths: ["/"], rules: [{ bots: "purpose:ads", expect: "blocked" }] }, /purpose/],
    [{ site: "https://e.com", paths: ["/"], rules: [{ bots: ["GPTBot"], expect: "maybe" }] }, /expect/],
    [{ site: "https://e.com", paths: ["/"], rules: [], extra: 1 }, /extra/],
  ])("rejects %j", (input, message) => {
    expect(() => parsePolicy(input)).toThrow(message);
  });
});
