import { describe, expect, it } from "vitest";
import { parseHeaderDirectives, parseDirectiveList, summarise } from "./directives.js";

describe("parseDirectiveList", () => {
  it("splits, lower-cases and trims", () => {
    expect(parseDirectiveList(" NoIndex , nofollow")).toEqual(["noindex", "nofollow"]);
  });

  it("keeps values on directives such as max-snippet", () => {
    expect(parseDirectiveList("max-snippet:50, max-image-preview: large")).toEqual(["max-snippet:50", "max-image-preview:large"]);
  });
});

describe("parseHeaderDirectives (X-Robots-Tag)", () => {
  it("applies unscoped directives to every crawler", () => {
    expect(parseHeaderDirectives("noindex, nofollow")).toEqual([{ agent: null, directives: ["noindex", "nofollow"] }]);
  });

  it("scopes directives after a crawler name until the next name", () => {
    expect(parseHeaderDirectives("googlebot: noindex, nosnippet, otherbot: nofollow")).toEqual([
      { agent: "googlebot", directives: ["noindex", "nosnippet"] },
      { agent: "otherbot", directives: ["nofollow"] },
    ]);
  });

  it("does not mistake a directive with a value for a crawler name", () => {
    expect(parseHeaderDirectives("max-snippet: 20, unavailable_after: 25 Jun 2030 15:00:00 PST")).toEqual([
      { agent: null, directives: ["max-snippet:20", "unavailable_after:25 jun 2030 15:00:00 pst"] },
    ]);
  });

  it("handles a scoped directive that has a value", () => {
    expect(parseHeaderDirectives("applebot: max-snippet: 0")).toEqual([{ agent: "applebot", directives: ["max-snippet:0"] }]);
  });
});

describe("summarise", () => {
  it("expands none and reads max-snippet", () => {
    expect(summarise(["none", "max-snippet:0"])).toEqual({
      noindex: true, nofollow: true, nosnippet: false, noarchive: false, maxSnippet: 0,
    });
  });

  it("keeps -1 (no limit) as -1, and lets any real limit win over it", () => {
    expect(summarise(["max-snippet:-1"]).maxSnippet).toBe(-1);
    expect(summarise(["max-snippet:-1", "max-snippet:30"]).maxSnippet).toBe(30);
    expect(JSON.stringify(summarise(["max-snippet:-1"]))).toContain('"maxSnippet":-1');
  });

  it("ignores a malformed max-snippet", () => {
    expect(summarise(["max-snippet:abc"]).maxSnippet).toBeNull();
  });
});
