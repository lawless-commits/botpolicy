/** Checks a report against a policy. Pure. The last matching rule wins. */
import type { Report } from "../report/schema.js";
import type { BotRecord } from "../types.js";
import type { Policy, PolicyRule } from "./schema.js";

export type PolicyStatus = "pass" | "fail" | "not-measured";

export interface PolicyCheck {
  token: string;
  path: string;
  /** Index of the rule that set the expectation. */
  rule: number;
  expected: PolicyRule["expect"];
  actual: Report["verdicts"][number]["verdict"];
  /** True holds, false broken, null not measured. */
  ok: boolean | null;
  reason: string;
}

export interface PageCheck {
  path: string;
  requirement: "minTextWithoutJs" | "requireJsonLd";
  ok: boolean | null;
  reason: string;
}

export interface PolicyResult {
  status: PolicyStatus;
  checks: PolicyCheck[];
  pageChecks: PageCheck[];
}

export function selects(rule: Pick<PolicyRule, "bots">, bot: BotRecord): boolean {
  const { bots } = rule;
  if (bots === "*") return true;
  if (Array.isArray(bots)) return bots.some((t) => t.toLowerCase() === bot.token.toLowerCase());
  if (bots.startsWith("purpose:")) return bot.purpose === bots.slice(8);
  if (bots.startsWith("operator:")) return bot.operator.toLowerCase() === bots.slice(9).toLowerCase();
  return false;
}

function holds(expected: PolicyRule["expect"], actual: string): boolean {
  if (expected === "reachable") return actual === "allowed" || actual === "restricted";
  return expected === actual;
}

/** What decided a verdict, in words, e.g. "robots.txt line 2: Disallow: /". */
export function describeVerdict(v: Report["verdicts"][number]): string {
  if (v.decidedBy === "robots" && v.robots.line !== null) {
    return `robots.txt line ${v.robots.line}: ${v.robots.ruleText}${v.robots.managed ? ` [${v.robots.managed}]` : ""}`;
  }
  if (v.decidedBy === "robots") return "robots.txt could not be measured";
  if (v.decidedBy === "edge") return `the edge (simulated): it ${v.edge?.reason ?? "was refused"}`;
  if (v.decidedBy === "page") return v.verdict === "not-measured" ? "the page could not be measured" : `the page sets ${v.pageControls.join(", ")}`;
  if (v.robots.line !== null) return `robots.txt line ${v.robots.line}: ${v.robots.ruleText}`;
  return "nothing limits it";
}

export function evaluatePolicy(policy: Policy, report: Pick<Report, "verdicts" | "pages">, bots: readonly BotRecord[]): PolicyResult {
  const checks: PolicyCheck[] = [];
  for (const v of report.verdicts) {
    const bot = bots.find((b) => b.token === v.token);
    if (!bot) continue;
    let ruleIndex = -1;
    policy.rules.forEach((rule, i) => {
      const paths = rule.paths ?? policy.paths;
      if (paths.includes(v.path) && selects(rule, bot)) ruleIndex = i;
    });
    if (ruleIndex === -1) continue;
    const expected = policy.rules[ruleIndex]!.expect;
    const ok = v.verdict === "not-measured" ? null : holds(expected, v.verdict);
    const because = describeVerdict(v);
    checks.push({
      token: v.token, path: v.path, rule: ruleIndex, expected, actual: v.verdict, ok,
      reason:
        ok === null ? `${v.token} on ${v.path} was not measured (${because}).`
        : ok ? `${v.token} on ${v.path} is ${v.verdict}, as expected.`
        : `${v.token} on ${v.path} should be ${expected} but is ${v.verdict}, decided by ${because}.`,
    });
  }

  const pageChecks: PageCheck[] = [];
  const req = policy.page;
  for (const page of report.pages) {
    if (!policy.paths.includes(page.path)) continue;
    const measured = page.measured && page.status !== null && page.status >= 200 && page.status < 300;
    if (req?.minTextWithoutJs !== undefined) {
      const ok = measured ? page.textLength >= req.minTextWithoutJs : null;
      pageChecks.push({
        path: page.path, requirement: "minTextWithoutJs", ok,
        reason: ok === null ? `${page.path} was not measured.` : `${page.path} has ${page.textLength} characters without JavaScript (needs ${req.minTextWithoutJs}).`,
      });
    }
    if (req?.requireJsonLd?.length) {
      const types = page.jsonLd.filter((b) => b.valid).flatMap((b) => b.types);
      const missing = req.requireJsonLd.filter((t) => !types.includes(t));
      const ok = measured ? missing.length === 0 : null;
      pageChecks.push({
        path: page.path, requirement: "requireJsonLd", ok,
        reason: ok === null ? `${page.path} was not measured.` : ok ? `${page.path} declares ${req.requireJsonLd.join(", ")}.` : `${page.path} lacks JSON-LD of type ${missing.join(", ")} (found: ${types.join(", ") || "none"}).`,
      });
    }
  }

  const all = [...checks.map((c) => c.ok), ...pageChecks.map((c) => c.ok)];
  const status: PolicyStatus = all.includes(false) ? "fail" : all.includes(null) ? "not-measured" : "pass";
  return { status, checks, pageChecks };
}
