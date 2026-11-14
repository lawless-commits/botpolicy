import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { carriesWeight, EVIDENCE } from "./evidence.js";

const CATALOGUE = ["R1", "R2", "R3", "R4", "R5", "R6", "R7", "P1", "P2", "P3", "P4", "P5", "E1", "I1"];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith(".ts") && !path.endsWith(".test.ts") ? [path] : [];
  });
}

describe("evidence", () => {
  it("has exactly one entry per check in the catalogue", () => {
    expect(Object.keys(EVIDENCE).sort()).toEqual([...CATALOGUE].sort());
  });

  it.each(CATALOGUE)("%s has a level, a source and a date", (id) => {
    const entry = EVIDENCE[id]!;
    expect(["documented", "measured", "unproven"]).toContain(entry.level);
    expect(entry.source).toMatch(/^https:\/\//);
    expect(entry.sourceName.length).toBeGreaterThan(0);
    expect(entry.checked).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(entry.basis.length).toBeGreaterThan(0);
  });

  it("gives every check the code reports an evidence entry", () => {
    const src = fileURLToPath(new URL("..", import.meta.url));
    const used = new Set<string>();
    for (const file of sourceFiles(src)) {
      for (const match of readFileSync(file, "utf8").matchAll(/check:\s*"([A-Z]\d+)"/g)) used.add(match[1]!);
    }
    expect(used.size).toBeGreaterThan(0);
    for (const id of used) expect(EVIDENCE[id], `check ${id} has no evidence entry`).toBeDefined();
  });

  it("gives unproven checks no weight", () => {
    expect(carriesWeight("R4")).toBe(false);
    expect(carriesWeight("I1")).toBe(false);
    expect(carriesWeight("R1")).toBe(true);
    expect(carriesWeight("Z9")).toBe(false);
  });
});
