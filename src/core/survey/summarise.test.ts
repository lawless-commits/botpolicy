import { describe, expect, it } from "vitest";
import type { Report } from "../report/schema.js";
import { summariseSurvey } from "./summarise.js";

type V = Report["verdicts"][number];
const v = (token: string, robots: "allowed" | "blocked" | "not-measured", edge: string | null): V => ({
  token, path: "/", verdict: robots === "blocked" ? "blocked" : "allowed", decidedBy: "none",
  robots: { verdict: robots, line: null, ruleText: null, managed: null }, pageControls: [],
  edge: edge ? { class: edge as "served", status: 200, reason: "r", simulated: true } : null, notes: [],
});
const site = (verdicts: V[]) => ({ target: "https://s/", verdicts }) as Pick<Report, "target" | "verdicts">;

describe("summariseSurvey", () => {
  it("counts, per crawler, sites where the live site contradicts robots.txt", () => {
    const rows = summariseSurvey([
      site([v("GPTBot", "blocked", "served"), v("OAI-SearchBot", "allowed", "denied")]),
      site([v("GPTBot", "blocked", "denied"), v("OAI-SearchBot", "allowed", "served")]),
      site([v("GPTBot", "allowed", "challenged"), v("OAI-SearchBot", "not-measured", null)]),
    ]);
    expect(rows.find((r) => r.token === "GPTBot")).toEqual({
      token: "GPTBot", measured: 3, robotsBlocks: 2, blockedButServed: 1, robotsAllows: 1, allowedButRefused: 1,
    });
    expect(rows.find((r) => r.token === "OAI-SearchBot")).toMatchObject({ measured: 2, allowedButRefused: 1 });
  });

  it("leaves out results that were not measured", () => {
    const rows = summariseSurvey([site([v("GPTBot", "blocked", "not-measured")])]);
    expect(rows.find((r) => r.token === "GPTBot")).toMatchObject({ measured: 0 });
  });
});
