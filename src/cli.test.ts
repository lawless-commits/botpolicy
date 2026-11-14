import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { run } from "./cli.js";
import { BOTS } from "./core/registry.js";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
const fixture = (name: string) => fileURLToPath(new URL(`../fixtures/robots/${name}`, import.meta.url));

describe("cli", () => {
  it("prints the package version for --version", async () => {
    expect(await run(["--version"])).toEqual({ code: 0, stdout: `${pkg.version}\n`, stderr: "" });
  });

  it("prints help with no arguments", async () => {
    const result = await run([]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Usage: botpolicy");
  });

  it("exits 2 on an unknown flag", async () => {
    const result = await run(["--nope"]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("--nope");
  });

  it("exits 2 on an unknown command", async () => {
    expect((await run(["frobnicate"])).code).toBe(2);
  });

  it("lists every bot with its source and marks unverified ones", async () => {
    const result = await run(["bots"]);
    expect(result.code).toBe(0);
    for (const bot of BOTS) expect(result.stdout).toContain(bot.token);
    expect(result.stdout).toContain("UNVERIFIED");
  });

  it("lists bots as JSON", async () => {
    expect(JSON.parse((await run(["bots", "--json"])).stdout)).toHaveLength(BOTS.length);
  });
});

describe("cli robots", () => {
  it("reads a file offline and prints a verdict and deciding line per crawler", async () => {
    const result = await run(["robots", fixture("training-only.txt"), "--path", "/", "--path", "/blog/a"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/GPTBot\s+training\s+BLOCKED\s+line 2: Disallow: \//);
    expect(result.stdout).toMatch(/Path \/blog\/a[\s\S]*OAI-SearchBot\s+search\s+allowed\s+line 6: Allow: \/blog\//);
    expect(result.stdout).toContain("[warning] R5");
  });

  it("marks verdicts that a CDN-managed block decided", async () => {
    const result = await run(["robots", fixture("cloudflare-managed.txt")]);
    expect(result.stdout).toMatch(/ClaudeBot.*BLOCKED.*\[Cloudflare Managed content\]/);
  });

  it("prints JSON", async () => {
    const report = JSON.parse((await run(["robots", fixture("training-only.txt"), "--json"])).stdout);
    expect(report.status).toBe("parsed");
    expect(report.verdicts).toHaveLength(BOTS.length);
  });

  it("prints not measured and exits 3 when robots.txt cannot be fetched", async () => {
    const result = await run(["robots", "http://127.0.0.1:9/"]);
    expect(result.code).toBe(3);
    expect(result.stdout).toContain("NOT MEASURED");
    expect(result.stdout).toMatch(/GPTBot\s+training\s+not measured/);
  });

  it("exits 2 on a missing file", async () => {
    const result = await run(["robots", "/no/such/robots.txt"]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("cannot read");
  });

  it("exits 2 on a path without a leading slash", async () => {
    expect((await run(["robots", fixture("training-only.txt"), "--path", "blog"])).code).toBe(2);
  });
});
