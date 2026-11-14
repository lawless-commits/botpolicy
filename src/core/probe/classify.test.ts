import { describe, expect, it } from "vitest";
import { classify, type ProbeResponse } from "./classify.js";

const LONG = "<p>" + "Words anyone can read on this page without scripts. ".repeat(15) + "</p>";
const ok = (body = `<html><head><title>Home</title></head><body>${LONG}</body></html>`, extra: Partial<Extract<ProbeResponse, { ok: true }>> = {}): ProbeResponse => ({
  ok: true, status: 200, headers: { "content-type": "text/html" }, body, finalUrl: "https://e.com/", ...extra,
});
const failed = (error = "timeout"): ProbeResponse => ({ ok: false, error, message: "m" });

describe("classify", () => {
  it("is served when the crawler gets what the baseline got", () => {
    expect(classify(ok(), ok())).toMatchObject({ class: "served", simulated: true });
  });

  it.each([401, 403, 404, 410, 429, 451, 500, 503])("is denied when the crawler gets %s and the baseline got 200", (status) => {
    expect(classify(ok(), ok("no", { status })).class).toBe("denied");
  });

  it("is challenged by a Cloudflare challenge header", () => {
    const res = ok("<html><title>Just a moment...</title></html>", { status: 403, headers: { "content-type": "text/html", "cf-mitigated": "challenge" } });
    expect(classify(ok(), res)).toMatchObject({ class: "challenged" });
  });

  it.each([
    "<title>Just a moment...</title><script src=/cdn-cgi/challenge-platform/h/b/orchestrate/jsch/v1></script>",
    "<div id=px-captcha></div>",
    "<script src=/_Incapsula_Resource?SWJIYLWA=1></script>",
    "<div class=g-recaptcha></div>",
    "<title>Attention Required! | Cloudflare</title>",
  ])("is challenged by a challenge page, even with status 200: %s", (body) => {
    expect(classify(ok(), ok(`<html>${body}</html>`)).class).toBe("challenged");
  });

  it("is different when the crawler is redirected elsewhere", () => {
    expect(classify(ok(), ok(undefined, { finalUrl: "https://e.com/blocked" }))).toMatchObject({ class: "different" });
  });

  it("is different when the crawler gets much less text", () => {
    const res = ok("<html><head><title>Home</title></head><body><p>Short.</p></body></html>");
    expect(classify(ok(), res).reason).toMatch(/text/);
    expect(classify(ok(), res).class).toBe("different");
  });

  it("is different when the title changes", () => {
    const res = ok(`<html><head><title>Access denied</title></head><body>${LONG}</body></html>`);
    expect(classify(ok(), res).class).toBe("different");
  });

  it("ignores small differences such as a timestamp", () => {
    const res = ok(`<html><head><title>Home</title></head><body>${LONG}<p>Generated 12:01</p></body></html>`);
    expect(classify(ok(), res).class).toBe("served");
  });

  it("is not measured when either request failed", () => {
    expect(classify(failed(), ok()).class).toBe("not-measured");
    expect(classify(ok(), failed()).class).toBe("not-measured");
  });

  it("is not measured when the baseline itself was not a 2xx", () => {
    expect(classify(ok("x", { status: 503 }), ok("x", { status: 503 }))).toMatchObject({ class: "not-measured" });
  });

  it("always carries the simulated label", () => {
    for (const res of [ok(), ok("x", { status: 403 }), failed()]) expect(classify(ok(), res).simulated).toBe(true);
  });
});
