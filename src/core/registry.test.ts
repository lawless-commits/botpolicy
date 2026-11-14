import { describe, expect, it } from "vitest";
import { BOTS, findBot } from "./registry.js";

const PURPOSES = ["training", "search", "user-fetch", "other"];
const STANCES = ["yes", "no", "unstated"];

describe("bot registry", () => {
  it("has unique tokens, case-insensitively", () => {
    const tokens = BOTS.map((b) => b.token.toLowerCase());
    expect(new Set(tokens).size).toBe(tokens.length);
  });

  it.each(BOTS.map((b) => [b.token, b] as const))("%s is well formed", (_, bot) => {
    expect(PURPOSES).toContain(bot.purpose);
    expect(STANCES).toContain(bot.obeysRobots);
    expect(bot.token).toMatch(/^[A-Za-z_-]+$/);
    if (bot.docsUrl !== null) expect(bot.docsUrl).toMatch(/^https:\/\//);
    if (bot.verified !== null) {
      expect(bot.verified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(bot.docsUrl, "a verified record needs its documentation link").not.toBeNull();
    } else {
      expect(bot.note ?? "", "an unverified record must say so").toMatch(/^Unverified/);
    }
    if (!bot.isCrawler) expect(bot.userAgent).toBeNull();
    if (bot.obeysRobots === "no") expect(bot.obeysRobotsQuote).not.toBeNull();
  });

  it("finds a bot regardless of case", () => {
    expect(findBot("gptbot")?.token).toBe("GPTBot");
    expect(findBot("nope")).toBeUndefined();
  });
});

describe("page controls", () => {
  it("are documented with a source wherever present", () => {
    for (const bot of BOTS) {
      if (bot.pageControls === null) continue;
      expect(bot.pageControls.source).toMatch(/^https:\/\//);
      expect(bot.pageControls.metaNames.length).toBeGreaterThan(0);
    }
  });

  it("are listed only for the crawlers whose operators document them", () => {
    expect(BOTS.filter((b) => b.pageControls).map((b) => b.token)).toEqual(["Googlebot", "Applebot", "Amazonbot"]);
  });
});
