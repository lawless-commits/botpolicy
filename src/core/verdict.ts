/** Combines the robots and page layers into one verdict per crawler and path. Pure. */
import type { PageReport } from "./page/analyse.js";
import { summarise } from "./page/directives.js";
import type { RobotsReport } from "./robots/checks.js";
import type { BotRecord } from "./types.js";

export type VerdictValue = "allowed" | "blocked" | "restricted" | "not-measured";

export interface Verdict {
  token: string;
  path: string;
  verdict: VerdictValue;
  /** The layer that decided the verdict; "none" when nothing limited the crawler. */
  decidedBy: "robots" | "page" | "none";
  robots: { verdict: "allowed" | "blocked" | "not-measured"; line: number | null; ruleText: string | null; managed: string | null };
  /** Page directives that limited the crawler. */
  pageControls: string[];
  notes: string[];
}

function restrictions(directives: string[], honoured: string[] | null): string[] {
  const s = summarise(directives);
  const out: string[] = [];
  const ok = (d: string) => honoured === null || honoured.includes(d);
  if (s.noindex && (ok("noindex") || ok("none"))) out.push(directives.includes("none") && !directives.includes("noindex") ? "none" : "noindex");
  if (s.nosnippet && ok("nosnippet")) out.push("nosnippet");
  if (s.maxSnippet === 0 && ok("max-snippet")) out.push("max-snippet:0");
  return out;
}

export function combine(robots: RobotsReport, pages: Record<string, PageReport>, bots: readonly BotRecord[]): Verdict[] {
  const out: Verdict[] = [];
  for (const r of robots.verdicts) {
    const bot = bots.find((b) => b.token === r.token);
    if (!bot) continue;
    const verdict: Verdict = {
      token: r.token,
      path: r.path,
      verdict: "allowed",
      decidedBy: "none",
      robots: { verdict: r.verdict, line: r.line, ruleText: r.ruleText, managed: r.managed },
      pageControls: [],
      notes: r.note ? [r.note] : [],
    };
    out.push(verdict);

    // 1. robots.txt not measured.
    if (r.verdict === "not-measured") {
      verdict.verdict = "not-measured";
      verdict.decidedBy = "robots";
      continue;
    }
    // 2. robots.txt blocks.
    if (r.verdict === "blocked") {
      verdict.verdict = "blocked";
      verdict.decidedBy = "robots";
      if (bot.obeysRobots === "no" && bot.obeysRobotsQuote) {
        verdict.notes.push(`${bot.operator} says: "${bot.obeysRobotsQuote}"`);
      }
      continue;
    }
    // Control-only tokens send no requests; only robots.txt speaks to them.
    if (!bot.isCrawler) continue;

    // 3. The page could not be measured for this request.
    const page = pages[r.path];
    if (!page || !page.measured || page.status === null || page.status < 200 || page.status >= 300) {
      verdict.verdict = "not-measured";
      verdict.decidedBy = "page";
      continue;
    }

    // 4 and 5. Page-level controls.
    const name = bot.token.toLowerCase();
    const applicable = page.directives.filter((d) => d.agent === null || d.agent === name);
    const controls = bot.pageControls;
    if (controls) {
      const honoured = applicable
        .filter((d) => (d.source === "header" ? controls.header : controls.metaNames.includes(d.agent ?? "robots")))
        .flatMap((d) => d.directives);
      const limits = restrictions(honoured, controls.directives);
      if (limits.length) {
        verdict.verdict = "restricted";
        verdict.decidedBy = "page";
        verdict.pageControls = limits;
        continue;
      }
    }
    const unhonoured = restrictions(applicable.flatMap((d) => d.directives), null);
    if (unhonoured.length) {
      verdict.notes.push(`The page sets ${unhonoured.join(", ")}, which the operator does not document honouring${controls ? " in this form" : ""}.`);
    }
  }
  return out;
}
