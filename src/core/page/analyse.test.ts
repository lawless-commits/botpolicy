import { describe, expect, it } from "vitest";
import { analysePage, directivesFor, type PageInput } from "./analyse.js";

const html = (body: string, head = "") => `<!doctype html><html><head><title>t</title>${head}</head><body>${body}</body></html>`;
const LONG = "<p>" + "Plain words a crawler can read without running any script. ".repeat(12) + "</p>";

function page(body: string, extra: Partial<Extract<PageInput, { kind: "response" }>> = {}): PageInput {
  return {
    kind: "response",
    url: "https://example.com/a",
    finalUrl: "https://example.com/a",
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
    body,
    redirects: [],
    ...extra,
  };
}
const ids = (r: ReturnType<typeof analysePage>, check: string) => r.findings.filter((f) => f.check === check);

describe("P1: X-Robots-Tag", () => {
  it("records a header that applies to every crawler", () => {
    const r = analysePage(page(html(LONG), { headers: { "content-type": "text/html", "x-robots-tag": "noindex" } }));
    expect(directivesFor(r, "GPTBot").noindex).toBe(true);
    expect(ids(r, "P1")).toEqual([expect.objectContaining({ severity: "warning" })]);
  });

  it("applies a scoped header only to that crawler", () => {
    const r = analysePage(page(html(LONG), { headers: { "content-type": "text/html", "x-robots-tag": "googlebot: nosnippet" } }));
    expect(directivesFor(r, "Googlebot").nosnippet).toBe(true);
    expect(directivesFor(r, "GPTBot").nosnippet).toBe(false);
    expect(ids(r, "P1")[0]!.bots).toEqual(["Googlebot"]);
  });
});

describe("P2: robots meta tags and snippet controls", () => {
  it("reads <meta name=robots>", () => {
    const r = analysePage(page(html(LONG, '<meta name="robots" content="noindex, nofollow">')));
    expect(directivesFor(r, "ClaudeBot")).toMatchObject({ noindex: true, nofollow: true });
    expect(ids(r, "P2")).toHaveLength(1);
  });

  it("reads a crawler-named meta tag for that crawler only, case-insensitively", () => {
    const r = analysePage(page(html(LONG, '<meta name="GoogleBot" content="max-snippet:0">')));
    expect(directivesFor(r, "Googlebot").maxSnippet).toBe(0);
    expect(directivesFor(r, "Applebot").maxSnippet).toBeNull();
  });

  it("merges header and meta, keeping the most restrictive", () => {
    const r = analysePage(page(html(LONG, '<meta name="robots" content="max-snippet:50">'), {
      headers: { "content-type": "text/html", "x-robots-tag": "max-snippet:10" },
    }));
    expect(directivesFor(r, "Googlebot").maxSnippet).toBe(10);
  });

  it("counts data-nosnippet elements", () => {
    const r = analysePage(page(html(`${LONG}<div data-nosnippet>hidden</div><span data-nosnippet="">x</span>`)));
    expect(r.dataNosnippetCount).toBe(2);
    expect(ids(r, "P2")).toEqual([expect.objectContaining({ severity: "info" })]);
  });

  it("reads meta robots even when it ends up in <body>", () => {
    const r = analysePage(page(html(`${LONG}<meta name="robots" content="noindex">`)));
    expect(directivesFor(r, "GPTBot").noindex).toBe(true);
  });
});

describe("P3: status, redirects and canonical", () => {
  it("reports a non-2xx page as an error", () => {
    const r = analysePage(page(html("gone"), { status: 404 }));
    expect(ids(r, "P3")).toEqual([expect.objectContaining({ severity: "error" })]);
  });

  it("reports redirects", () => {
    const r = analysePage(page(html(LONG), { redirects: ["https://example.com/b"], finalUrl: "https://example.com/b" }));
    expect(ids(r, "P3")).toEqual([expect.objectContaining({ severity: "info" })]);
  });

  it("warns when the canonical points elsewhere", () => {
    const r = analysePage(page(html(LONG, '<link rel="canonical" href="/other">')));
    expect(r.canonical).toBe("https://example.com/other");
    expect(ids(r, "P3")).toEqual([expect.objectContaining({ severity: "warning" })]);
  });

  it("is quiet when the canonical is the page itself", () => {
    const r = analysePage(page(html(LONG, '<link rel="canonical" href="https://example.com/a">')));
    expect(ids(r, "P3")).toEqual([]);
  });

  it("reads a canonical from the Link header", () => {
    const r = analysePage(page(html(LONG), {
      headers: { "content-type": "text/html", link: '<https://example.com/c>; rel="canonical"' },
    }));
    expect(r.canonical).toBe("https://example.com/c");
  });
});

describe("P4: text without JavaScript", () => {
  it("counts readable text and ignores scripts and styles", () => {
    const r = analysePage(page(html(`<script>var x = "${"s".repeat(2000)}";</script><style>p{}</style><p>Hello   world</p>`)));
    expect(r.textLength).toBe("Hello world".length);
  });

  it("warns about an empty JavaScript shell", () => {
    const r = analysePage(page(html('<div id="root"></div><script src="/app.js"></script>')));
    expect(r.textLength).toBe(0);
    expect(ids(r, "P4")).toEqual([expect.objectContaining({ severity: "warning" })]);
  });

  it("is quiet when there is enough text", () => {
    expect(ids(analysePage(page(html(LONG))), "P4")).toEqual([]);
  });

  it("takes the threshold as an option", () => {
    expect(ids(analysePage(page(html("<p>short text</p>")), { minText: 5 }), "P4")).toEqual([]);
  });
});

describe("P5: JSON-LD", () => {
  it("collects types, including @graph and arrays", () => {
    const ld = JSON.stringify({ "@context": "https://schema.org", "@graph": [{ "@type": "Organization" }, { "@type": ["Product", "Thing"] }] });
    const r = analysePage(page(html(LONG, `<script type="application/ld+json">${ld}</script>`)));
    expect(r.jsonLd).toEqual([{ index: 0, valid: true, types: ["Organization", "Product", "Thing"] }]);
    expect(ids(r, "P5")).toEqual([]);
  });

  it("reports a block that does not parse", () => {
    const r = analysePage(page(html(LONG, '<script type="application/ld+json">{"@type": "Product",}</script>')));
    expect(r.jsonLd[0]).toMatchObject({ valid: false });
    expect(ids(r, "P5")).toEqual([expect.objectContaining({ severity: "warning" })]);
  });

  it("reports a block with no type", () => {
    const r = analysePage(page(html(LONG, '<script type="application/ld+json">{"name": "x"}</script>')));
    expect(ids(r, "P5")[0]!.message).toMatch(/no @type/);
  });
});

describe("pages that cannot be analysed", () => {
  it("marks an unreachable page as not measured", () => {
    const r = analysePage({ kind: "unreachable", url: "https://example.com/a", error: "timeout", message: "slow" });
    expect(r.measured).toBe(false);
    expect(ids(r, "P3")).toEqual([expect.objectContaining({ severity: "error" })]);
  });

  it("skips HTML checks on a non-HTML response", () => {
    const r = analysePage(page("%PDF-1.7", { headers: { "content-type": "application/pdf", "x-robots-tag": "noindex" } }));
    expect(r.isHtml).toBe(false);
    expect(directivesFor(r, "GPTBot").noindex).toBe(true);
    expect(ids(r, "P4")).toEqual([]);
  });
});
