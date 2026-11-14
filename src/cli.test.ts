import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { run } from "./cli.js";

const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };

describe("cli", () => {
  it("prints the package version for --version", () => {
    expect(run(["--version"])).toEqual({
      code: 0,
      stdout: `${pkg.version}\n`,
      stderr: "",
    });
  });

  it("prints the version when called with no arguments", () => {
    expect(run([]).stdout).toBe(`${pkg.version}\n`);
  });

  it("exits 2 on an unknown flag", () => {
    const result = run(["--nope"]);
    expect(result.code).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("--nope");
  });
});
