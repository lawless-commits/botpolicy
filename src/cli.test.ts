import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { run } from "./cli.js";
import { BOTS } from "./core/registry.js";

const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };

describe("cli", () => {
  it("prints the package version for --version", () => {
    expect(run(["--version"])).toEqual({ code: 0, stdout: `${pkg.version}\n`, stderr: "" });
  });

  it("prints help with no arguments", () => {
    const result = run([]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Usage: botpolicy");
  });

  it("exits 2 on an unknown flag", () => {
    const result = run(["--nope"]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("--nope");
  });

  it("exits 2 on an unknown command", () => {
    expect(run(["frobnicate"]).code).toBe(2);
  });

  it("lists every bot with its source and marks unverified ones", () => {
    const result = run(["bots"]);
    expect(result.code).toBe(0);
    for (const bot of BOTS) expect(result.stdout).toContain(bot.token);
    expect(result.stdout).toContain("UNVERIFIED");
    expect(result.stdout).toContain("https://developers.openai.com/api/docs/bots");
  });

  it("lists bots as JSON", () => {
    const parsed = JSON.parse(run(["bots", "--json"]).stdout) as unknown[];
    expect(parsed).toHaveLength(BOTS.length);
  });
});
