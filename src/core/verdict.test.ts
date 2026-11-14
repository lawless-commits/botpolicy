import { describe, expect, it } from "vitest";
import { analysePage, type PageInput } from "./page/analyse.js";
import { BOTS } from "./registry.js";
import { analyseRobots } from "./robots/checks.js";
import { combine } from "./verdict.js";

const LONG = "<p>" + "Readable words without any script at all. ".repeat(20) + "</p>";
const robotsOk = (body: string) =>
  analyseRobots({ kind: "response", url: "u", finalUrl: "u", status: 200, contentType: "text/plain", body }, BOTS, ["/"]);
const pageOf = (head = "", headers: Record<string, string> = {}, status = 200) =>
  analysePage({
    kind: "response", url: "https://e.com/", finalUrl: "https://e.com/", status, redirects: [],
    headers: { "content-type": "text/html", ...headers },
    body: `<!doctype html><html><head>${head}</head><body>${LONG}</body></html>`,
  } satisfies PageInput);
const v = (verdicts: ReturnType<typeof combine>, token: string) => verdicts.find((x) => x.token === token)!;

describe("combine", () => {
  it("is allowed when nothing restricts", () => {
    const out = combine(robotsOk("User-agent: *\nAllow: /\n"), { "/": pageOf() }, BOTS);
    expect(v(out, "GPTBot")).toMatchObject({ verdict: "allowed", decidedBy: "none" });
    expect(out).toHaveLength(BOTS.length);
  });

  it("lets robots.txt decide a block, with the line", () => {
    const out = combine(robotsOk("User-agent: GPTBot\nDisallow: /\n"), { "/": pageOf() }, BOTS);
    expect(v(out, "GPTBot")).toMatchObject({ verdict: "blocked", decidedBy: "robots", robots: { line: 2, ruleText: "Disallow: /" } });
  });

  it("notes when the operator says robots.txt may not apply", () => {
    const out = combine(robotsOk("User-agent: *\nDisallow: /\n"), { "/": pageOf() }, BOTS);
    expect(v(out, "ChatGPT-User").verdict).toBe("blocked");
    expect(v(out, "ChatGPT-User").notes.join(" ")).toMatch(/robots\.txt rules may not apply/);
  });

  it("is not measured when robots.txt is not measured", () => {
    const robots = analyseRobots({ kind: "unreachable", url: "u", error: "timeout", message: "m" }, BOTS, ["/"]);
    expect(v(combine(robots, { "/": pageOf() }, BOTS), "GPTBot")).toMatchObject({ verdict: "not-measured", decidedBy: "robots" });
  });

  it("is not measured when the page is unreachable or not 2xx", () => {
    const unreachable = analysePage({ kind: "unreachable", url: "https://e.com/", error: "timeout", message: "m" });
    expect(v(combine(robotsOk(""), { "/": unreachable }, BOTS), "GPTBot")).toMatchObject({ verdict: "not-measured", decidedBy: "page" });
    expect(v(combine(robotsOk(""), { "/": pageOf("", {}, 403) }, BOTS), "GPTBot")).toMatchObject({ verdict: "not-measured", decidedBy: "page" });
  });

  it("keeps a robots block even when the page is not measured", () => {
    const unreachable = analysePage({ kind: "unreachable", url: "https://e.com/", error: "timeout", message: "m" });
    expect(v(combine(robotsOk("User-agent: *\nDisallow: /\n"), { "/": unreachable }, BOTS), "GPTBot").verdict).toBe("blocked");
  });

  it("restricts only crawlers whose operator documents honouring the control", () => {
    const out = combine(robotsOk(""), { "/": pageOf('<meta name="robots" content="noindex">') }, BOTS);
    expect(v(out, "Googlebot")).toMatchObject({ verdict: "restricted", decidedBy: "page" });
    expect(v(out, "Applebot").verdict).toBe("restricted");
    expect(v(out, "Amazonbot").verdict).toBe("restricted");
    expect(v(out, "GPTBot")).toMatchObject({ verdict: "allowed" });
    expect(v(out, "GPTBot").notes.join(" ")).toMatch(/noindex, which the operator does not document honouring/);
  });

  it("respects which meta names an operator honours", () => {
    const out = combine(robotsOk(""), { "/": pageOf('<meta name="applebot" content="noindex">') }, BOTS);
    expect(v(out, "Applebot").verdict).toBe("restricted");
    expect(v(out, "Googlebot").verdict).toBe("allowed");
  });

  it("ignores the header for an operator that does not document it", () => {
    const out = combine(robotsOk(""), { "/": pageOf("", { "x-robots-tag": "noindex" }) }, BOTS);
    expect(v(out, "Googlebot").verdict).toBe("restricted");
    expect(v(out, "Amazonbot").verdict).toBe("allowed");
  });

  it("treats nosnippet and max-snippet:0 as restrictions, but not max-snippet:50", () => {
    expect(v(combine(robotsOk(""), { "/": pageOf('<meta name="robots" content="nosnippet">') }, BOTS), "Googlebot").verdict).toBe("restricted");
    expect(v(combine(robotsOk(""), { "/": pageOf('<meta name="robots" content="max-snippet:0">') }, BOTS), "Googlebot").verdict).toBe("restricted");
    expect(v(combine(robotsOk(""), { "/": pageOf('<meta name="robots" content="max-snippet:50">') }, BOTS), "Googlebot").verdict).toBe("allowed");
    expect(v(combine(robotsOk(""), { "/": pageOf('<meta name="robots" content="nosnippet">') }, BOTS), "Amazonbot").verdict).toBe("allowed");
  });

  it("gives control-only tokens the robots verdict alone", () => {
    const out = combine(robotsOk(""), { "/": pageOf('<meta name="robots" content="noindex">') }, BOTS);
    expect(v(out, "Google-Extended")).toMatchObject({ verdict: "allowed", decidedBy: "none" });
    expect(v(out, "Google-Extended").notes).toEqual([]);
  });
});
