import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { startSite, type FixtureSite } from "../fixtures/server.mjs";
import { run } from "./cli.js";
import { ReportSchema } from "./core/report/schema.js";
import { createFetcher } from "./net/fetcher.js";

let site: FixtureSite | null = null;
afterEach(async () => {
  await site?.close();
  site = null;
});

const policyFile = (name: string) => fileURLToPath(new URL(`../fixtures/policies/${name}`, import.meta.url));
async function serve(name: string) {
  site = await startSite(fileURLToPath(new URL(`../fixtures/sites/${name}`, import.meta.url)));
  const port = site.port;
  return createFetcher({ userAgent: "t", checkAddress: (ip, p) => ip === "127.0.0.1" && p === port });
}

describe("botpolicy test", () => {
  it("passes when the site matches the policy (CDN blocks training, search allowed)", async () => {
    const fetcher = await serve("cdn-managed");
    const result = await run(["test", site!.url, "--policy", policyFile("search-in-training-out.json")], { fetcher });
    expect(result.stdout).toContain("PASS");
    expect(result.code).toBe(0);
  });

  it("fails with exit 1 and names what decided it", async () => {
    const fetcher = await serve("clean");
    const result = await run(["test", site!.url, "--policy", policyFile("search-in-training-out.json")], { fetcher });
    expect(result.code).toBe(1);
    expect(result.stdout).toContain("FAIL");
    expect(result.stdout).toContain("BROKEN  GPTBot on / should be blocked but is allowed, decided by robots.txt line 2: Allow: /");
  });

  it("prints GitHub annotations with --annotate", async () => {
    const fetcher = await serve("clean");
    const result = await run(["test", site!.url, "--policy", policyFile("search-in-training-out.json"), "--annotate"], { fetcher });
    expect(result.stdout).toMatch(/^::error title=botpolicy::GPTBot on \/ should be blocked/m);
  });

  it("applies path exceptions, last rule winning", async () => {
    const fetcher = await serve("cdn-managed");
    const result = await run(["test", site!.url, "--policy", policyFile("press-exception.json"), "--json"], { fetcher });
    const report = ReportSchema.parse(JSON.parse(result.stdout));
    const googlebot = report.policy!.checks.find((c) => c.token === "Googlebot" && c.path === "/admin/x")!;
    expect(googlebot).toMatchObject({ expected: "allowed", actual: "blocked", ok: false, rule: 3 });
    expect(googlebot.reason).toContain("robots.txt line 35: Disallow: /admin/");
    expect(result.code).toBe(1);
  });

  it("checks page requirements", async () => {
    const fetcher = await serve("js-shell");
    const result = await run(["test", site!.url, "--policy", policyFile("open-and-readable.json")], { fetcher });
    expect(result.code).toBe(1);
    expect(result.stdout).toContain("has 0 characters without JavaScript (needs 500)");
    expect(result.stdout).toContain("lacks JSON-LD of type Organization");
  });

  it("exits 3 when the site cannot be measured", async () => {
    const result = await run(["test", "http://127.0.0.1:9/", "--policy", policyFile("search-in-training-out.json")]);
    expect(result.code).toBe(3);
  });

  it("exits 2 on a missing or invalid policy file", async () => {
    expect((await run(["test", "--policy", "/no/such.json"])).code).toBe(2);
    const dir = mkdtempSync(join(tmpdir(), "botpolicy-"));
    writeFileSync(join(dir, "bad.json"), JSON.stringify({ site: "https://e.com", paths: ["/"], rules: [{ bots: ["Nope"], expect: "blocked" }] }));
    const result = await run(["test", "--policy", join(dir, "bad.json")]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("unknown crawler 'Nope'");
  });
});

describe("botpolicy init", () => {
  it("writes a policy that the same site then passes", async () => {
    const fetcher = await serve("cdn-managed");
    const written: Record<string, string> = {};
    const init = await run(["init", site!.url, "--path", "/", "--path", "/admin/x"], {
      fetcher, exists: () => false, writeFile: (p, t) => (written[p] = t),
    });
    expect(init.code).toBe(0);
    expect(Object.keys(written)).toEqual(["botpolicy.json"]);
    const dir = mkdtempSync(join(tmpdir(), "botpolicy-"));
    writeFileSync(join(dir, "botpolicy.json"), written["botpolicy.json"]!);
    const fetcher2 = createFetcher({ userAgent: "t", checkAddress: (ip, p) => ip === "127.0.0.1" && p === site!.port });
    const test = await run(["test", site!.url, "--policy", join(dir, "botpolicy.json")], { fetcher: fetcher2 });
    expect(test.code).toBe(0);
    expect(JSON.parse(readFileSync(join(dir, "botpolicy.json"), "utf8")).rules.length).toBeGreaterThan(0);
  });

  it("refuses to overwrite without --force", async () => {
    const result = await run(["init", "https://example.com"], { exists: () => true, writeFile: () => {} });
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("--force");
  });

  it("writes nothing and exits 3 when the site cannot be measured", async () => {
    const written: string[] = [];
    const result = await run(["init", "http://127.0.0.1:9/"], { exists: () => false, writeFile: (p) => written.push(p) });
    expect(result.code).toBe(3);
    expect(written).toEqual([]);
  });
});
