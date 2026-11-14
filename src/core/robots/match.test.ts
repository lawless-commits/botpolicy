import { describe, expect, it } from "vitest";
import { evaluate, normalisePath } from "./match.js";
import { parseRobots } from "./parse.js";

// RFC 9309 section 5.1.
const RFC_SIMPLE = `User-Agent: *
Disallow: *.gif$
Disallow: /example/
Allow: /publications/

User-Agent: foobot
Disallow:/
Allow:/example/page.html
Allow:/example/allowed.gif

User-Agent: barbot
User-Agent: bazbot
Disallow: /example/page.html

User-Agent: quxbot

EOF`;

function verdict(robots: string, token: string, path: string) {
  return evaluate(parseRobots(robots), token, path);
}

describe("RFC 9309 section 5.1", () => {
  it.each([
    ["foobot", "/example/page.html", "allowed", 8],
    ["foobot", "/example/allowed.gif", "allowed", 9],
    ["foobot", "/example/other.html", "blocked", 7],
    ["foobot", "/", "blocked", 7],
    ["barbot", "/example/page.html", "blocked", 13],
    ["bazbot", "/example/page.html", "blocked", 13],
    ["barbot", "/example/other.gif", "allowed", null],
    ["quxbot", "/example/page.html", "allowed", null],
    ["otherbot", "/picture.gif", "blocked", 2],
    ["otherbot", "/example/page.html", "blocked", 3],
    ["otherbot", "/publications/a.html", "allowed", 4],
    ["otherbot", "/publications/a.gif", "allowed", 4], // 14-octet allow beats 6-octet *.gif$
    ["otherbot", "/index.html", "allowed", null],
  ] as const)("%s %s is %s (line %s)", (token, path, expected, line) => {
    const result = verdict(RFC_SIMPLE, token, path);
    expect(result.verdict).toBe(expected);
    expect(result.rule?.line ?? null).toBe(line);
  });

  it("names the group that applied", () => {
    expect(verdict(RFC_SIMPLE, "barbot", "/").group).toMatchObject({ kind: "named", lines: [11] });
    expect(verdict(RFC_SIMPLE, "otherbot", "/").group).toMatchObject({ kind: "star", lines: [1] });
  });
});

describe("RFC 9309 section 5.2: longest match", () => {
  const robots = "User-Agent: foobot\nAllow: /example/page/\nDisallow: /example/page/disallowed.gif\n";
  it.each([
    ["/example/page/", "allowed", 2],
    ["/example/page/disallowed.gif", "blocked", 3],
  ] as const)("%s is %s", (path, expected, line) => {
    const result = verdict(robots, "foobot", path);
    expect(result.verdict).toBe(expected);
    expect(result.rule?.line).toBe(line);
  });
});

describe("rule precedence", () => {
  it("lets allow win a tie of equal length", () => {
    const result = verdict("User-agent: *\nDisallow: /page\nAllow: /page\n", "x", "/page");
    expect(result).toMatchObject({ verdict: "allowed", rule: { line: 3 } });
  });

  it("compares lengths of the patterns, not of the matched text", () => {
    const result = verdict("User-agent: *\nAllow: /*\nDisallow: /ab\n", "x", "/abc");
    expect(result).toMatchObject({ verdict: "blocked", rule: { line: 3 } });
  });

  it("ignores an empty Disallow", () => {
    expect(verdict("User-agent: *\nDisallow:\n", "x", "/a").verdict).toBe("allowed");
  });

  it("always allows /robots.txt", () => {
    expect(verdict("User-agent: *\nDisallow: /\n", "x", "/robots.txt")).toMatchObject({
      verdict: "allowed",
      reason: "robots-txt-always-allowed",
    });
  });
});

describe("special characters", () => {
  it.each([
    ["/*.php$", "/index.php", true],
    ["/*.php$", "/index.php?x=1", false],
    ["/*.php$", "/index.php5", false],
    ["/*.php", "/dir/index.php5", true],
    ["/fish*", "/fishheads", true],
    ["/fish*", "/Fish", false],
    ["/fish$", "/fish", true],
    ["/fish$", "/fishy", false],
    ["/a*b*c", "/aXXbYYc", true],
    ["/foo/bar?baz=quz", "/foo/bar?baz=quz", true],
    ["/foo/bar/ツ", "/foo/bar/%E3%83%84", true],
    ["/foo/bar/%E3%83%84", "/foo/bar/ツ", true],
    ["/foo/bar/%62%61%7A", "/foo/bar/baz", true],
    ["/foo/bar/baz", "/foo/bar/%62%61%7a", true],
    ["/a%2Fb", "/a/b", false],
    ["/$", "/", true],
    ["/$", "/x", false],
  ] as const)("pattern %s against %s matches: %s", (pattern, path, matches) => {
    const result = verdict(`User-agent: *\nDisallow: ${pattern}\n`, "x", path);
    expect(result.verdict).toBe(matches ? "blocked" : "allowed");
  });

  it("normalises paths", () => {
    expect(normalisePath("/a b/ü?q=%7e")).toBe("/a%20b/%C3%BC?q=~");
    expect(normalisePath("")).toBe("/");
  });
});

describe("group selection", () => {
  it("matches tokens case-insensitively", () => {
    expect(verdict("User-agent: GPTBot\nDisallow: /\n", "gptbot", "/").verdict).toBe("blocked");
  });

  it("merges every group that names the crawler", () => {
    const robots = "User-agent: a\nDisallow: /x\n\nUser-agent: *\nDisallow: /\n\nUser-agent: a\nDisallow: /y\n";
    expect(verdict(robots, "a", "/y").verdict).toBe("blocked");
    expect(verdict(robots, "a", "/x").verdict).toBe("blocked");
    expect(verdict(robots, "a", "/z").verdict).toBe("allowed");
    expect(verdict(robots, "a", "/z").group).toMatchObject({ kind: "named", lines: [1, 7] });
  });

  it("merges every * group", () => {
    const robots = "User-agent: *\nDisallow: /x\n\nUser-agent: *\nDisallow: /y\n";
    expect(verdict(robots, "a", "/y").verdict).toBe("blocked");
  });

  it("does not fall back to * when a named group exists", () => {
    const robots = "User-agent: *\nDisallow: /\n\nUser-agent: a\nDisallow: /private\n";
    expect(verdict(robots, "a", "/public").verdict).toBe("allowed");
  });

  it("matches the product token, not a prefix of another token", () => {
    const robots = "User-agent: Googlebot-Image\nDisallow: /\n";
    expect(verdict(robots, "Googlebot", "/").verdict).toBe("allowed");
  });

  it("allows everything when no group applies", () => {
    expect(verdict("User-agent: a\nDisallow: /\n", "b", "/")).toMatchObject({
      verdict: "allowed",
      group: { kind: "none" },
      reason: "no-group",
    });
  });

  it("explains an allow with no matching rule", () => {
    expect(verdict("User-agent: *\nDisallow: /x\n", "b", "/y")).toMatchObject({
      verdict: "allowed",
      rule: null,
      reason: "no-rule-matched",
    });
  });

  it("carries the managed section of the deciding rule", () => {
    const robots = "# BEGIN Cloudflare Managed content\nUser-agent: GPTBot\nDisallow: /\n# END Cloudflare Managed Content\n";
    expect(verdict(robots, "GPTBot", "/").rule?.managed).toBe("Cloudflare Managed content");
  });
});
