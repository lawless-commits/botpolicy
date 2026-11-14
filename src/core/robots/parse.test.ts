import { describe, expect, it } from "vitest";
import { parseRobots } from "./parse.js";

describe("parseRobots", () => {
  it("groups consecutive user-agent lines and keeps line numbers", () => {
    const parsed = parseRobots(
      ["User-Agent: barbot", "User-Agent: bazbot", "Disallow: /example/page.html", "", "User-agent: *", "Allow: /"].join("\n"),
    );
    expect(parsed.groups).toHaveLength(2);
    expect(parsed.groups[0]!.agents).toEqual([
      { token: "barbot", raw: "barbot", line: 1 },
      { token: "bazbot", raw: "bazbot", line: 2 },
    ]);
    expect(parsed.groups[0]!.rules).toEqual([
      { directive: "disallow", pattern: "/example/page.html", line: 3 },
    ]);
    expect(parsed.groups[1]!.agents[0]!.token).toBe("*");
  });

  it("starts a new group when a user-agent line follows rules", () => {
    const parsed = parseRobots("User-agent: a\nDisallow: /x\nUser-agent: b\nDisallow: /y\n");
    expect(parsed.groups.map((g) => g.agents.map((a) => a.token))).toEqual([["a"], ["b"]]);
  });

  it("treats keys case-insensitively and tolerates missing space after the colon", () => {
    const parsed = parseRobots("USER-AGENT:foobot\nDISALLOW:/\nallow:/example/page.html\n");
    expect(parsed.groups[0]!.rules.map((r) => [r.directive, r.pattern])).toEqual([
      ["disallow", "/"],
      ["allow", "/example/page.html"],
    ]);
  });

  it("reduces a user-agent value to its product token, lower-cased", () => {
    const parsed = parseRobots("User-agent: FooBot/1.2 (+http://x)\nDisallow: /\n");
    expect(parsed.groups[0]!.agents[0]).toMatchObject({ token: "foobot", raw: "FooBot/1.2 (+http://x)" });
  });

  it("handles a BOM, CRLF and CR line endings, and comments", () => {
    const parsed = parseRobots("\uFEFFUser-agent: *\r\nDisallow: /a # not this\rAllow: /b\n# only a comment\n");
    expect(parsed.groups[0]!.rules).toEqual([
      { directive: "disallow", pattern: "/a", line: 2 },
      { directive: "allow", pattern: "/b", line: 3 },
    ]);
  });

  it("records rules before any user-agent as orphans, not as rules", () => {
    const parsed = parseRobots("Disallow: /\nUser-agent: *\nAllow: /\n");
    expect(parsed.orphanRules).toEqual([{ directive: "disallow", pattern: "/", line: 1 }]);
    expect(parsed.groups[0]!.rules).toHaveLength(1);
  });

  it("keeps an empty Disallow as a rule with an empty pattern", () => {
    const parsed = parseRobots("User-agent: *\nDisallow:\n");
    expect(parsed.groups[0]!.rules).toEqual([{ directive: "disallow", pattern: "", line: 2 }]);
  });

  it("collects sitemaps anywhere in the file", () => {
    const parsed = parseRobots("Sitemap: https://e.com/a.xml\nUser-agent: *\nDisallow:\nSitemap: https://e.com/b.xml\n");
    expect(parsed.sitemaps).toEqual([
      { url: "https://e.com/a.xml", line: 1 },
      { url: "https://e.com/b.xml", line: 4 },
    ]);
    expect(parsed.groups).toHaveLength(1);
  });

  it("does not let a sitemap line end a group's user-agent list", () => {
    const parsed = parseRobots("User-agent: a\nSitemap: https://e.com/s.xml\nUser-agent: b\nDisallow: /\n");
    expect(parsed.groups).toHaveLength(1);
    expect(parsed.groups[0]!.agents.map((a) => a.token)).toEqual(["a", "b"]);
  });

  it("parses Content-Signal lines into their group", () => {
    const parsed = parseRobots("User-agent: *\nContent-Signal: search=yes, ai-train=no\nAllow: /\n");
    expect(parsed.groups[0]!.contentSignals).toEqual([
      { line: 2, raw: "search=yes, ai-train=no", values: { search: "yes", "ai-train": "no" } },
    ]);
  });

  it("keeps other directives such as Crawl-delay on the group, and unknown lines aside", () => {
    const parsed = parseRobots("User-agent: *\nCrawl-delay: 5\nDisallow: /\nthis is junk\n");
    expect(parsed.groups[0]!.other).toEqual([{ key: "crawl-delay", value: "5", line: 2 }]);
    expect(parsed.invalidLines).toEqual([{ line: 4, text: "this is junk" }]);
  });

  it("marks rules inside a CDN-managed block", () => {
    const parsed = parseRobots(
      [
        "# BEGIN Cloudflare Managed content",
        "User-agent: GPTBot",
        "Disallow: /",
        "# END Cloudflare Managed Content",
        "User-agent: *",
        "Allow: /",
      ].join("\n"),
    );
    expect(parsed.managedSections).toEqual([{ name: "Cloudflare Managed content", start: 1, end: 4 }]);
    expect(parsed.groups[0]!.rules[0]!.managed).toBe("Cloudflare Managed content");
    expect(parsed.groups[1]!.rules[0]!.managed).toBeUndefined();
  });

  it("closes an unterminated managed block at the end of the file", () => {
    const parsed = parseRobots("# BEGIN Cloudflare Managed content\nUser-agent: *\nDisallow: /\n");
    expect(parsed.managedSections).toEqual([{ name: "Cloudflare Managed content", start: 1, end: 3 }]);
  });

  it("returns an empty result for an empty file", () => {
    expect(parseRobots("")).toMatchObject({ groups: [], sitemaps: [], orphanRules: [] });
  });
});
