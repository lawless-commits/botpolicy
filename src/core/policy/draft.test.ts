import { describe, expect, it } from "vitest";
import type { Report } from "../report/schema.js";
import { BOTS } from "../registry.js";
import { draftPolicy } from "./draft.js";
import { evaluatePolicy } from "./evaluate.js";
import { parsePolicy } from "./schema.js";

type V = Report["verdicts"][number];
const v = (token: string, path: string, verdict: V["verdict"]): V => ({
  token, path, verdict, decidedBy: "none", robots: { verdict: "allowed", line: null, ruleText: null, managed: null }, pageControls: [], notes: [],
});
const page = (path: string, textLength: number) => ({
  path, url: "u", finalUrl: "u", status: 200, measured: true, isHtml: true, redirects: [], directives: [],
  dataNosnippetCount: 0, canonical: null, textLength, jsonLd: [],
});

describe("draftPolicy", () => {
  const paths = ["/", "/press/"];
  const verdicts = BOTS.flatMap((b) =>
    paths.map((p) => v(b.token, p, b.purpose === "training" && !(b.token === "GPTBot" && p === "/press/") ? "blocked" : "allowed")),
  );
  const report = { target: "https://e.com/", verdicts, pages: [page("/", 900), page("/press/", 800)] };
  const policy = draftPolicy(report, paths, BOTS);

  it("writes one rule per purpose where the purpose is uniform", () => {
    expect(policy.rules).toContainEqual({ bots: "purpose:search", expect: "allowed" });
    expect(policy.rules).toContainEqual({ bots: "purpose:user-fetch", expect: "allowed" });
  });

  it("breaks a mixed purpose into token and path rules", () => {
    expect(policy.rules).toContainEqual({ bots: ["GPTBot"], paths: ["/press/"], expect: "allowed" });
    expect(policy.rules.find((r) => Array.isArray(r.bots) && r.bots.includes("ClaudeBot"))).toMatchObject({ expect: "blocked" });
  });

  it("produces a valid policy that the same report passes", () => {
    const parsed = parsePolicy(JSON.parse(JSON.stringify(policy)));
    expect(evaluatePolicy(parsed, report, BOTS).status).toBe("pass");
    expect(parsed.page).toEqual({ minTextWithoutJs: 500 });
  });
});
