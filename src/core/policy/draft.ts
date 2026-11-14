/** Drafts a policy from what a site does today, for botpolicy init. Pure. */
import type { Report } from "../report/schema.js";
import type { BotRecord } from "../types.js";
import type { Policy, PolicyRule } from "./schema.js";

const ORDER = ["search", "user-fetch", "training", "other"] as const;

export function draftPolicy(report: Pick<Report, "target" | "verdicts" | "pages">, paths: string[], bots: readonly BotRecord[]): Policy {
  const rules: PolicyRule[] = [];
  const verdictOf = (token: string, path: string) =>
    report.verdicts.find((v) => v.token === token && v.path === path)!.verdict as PolicyRule["expect"];

  for (const purpose of ORDER) {
    const group = bots.filter((b) => b.purpose === purpose);
    if (group.length === 0) continue;
    const all = group.flatMap((b) => paths.map((p) => verdictOf(b.token, p)));
    if (all.every((v) => v === all[0])) {
      rules.push({ bots: `purpose:${purpose}`, expect: all[0]! });
      continue;
    }
    const uniform = new Map<PolicyRule["expect"], string[]>();
    for (const bot of group) {
      const values = paths.map((p) => verdictOf(bot.token, p));
      if (values.every((v) => v === values[0])) {
        uniform.set(values[0]!, [...(uniform.get(values[0]!) ?? []), bot.token]);
      } else {
        paths.forEach((p, i) => rules.push({ bots: [bot.token], paths: [p], expect: values[i]! }));
      }
    }
    for (const [expect, tokens] of uniform) rules.push({ bots: tokens, expect });
  }

  const policy: Policy = {
    $schema: "https://unpkg.com/botpolicy/schema/policy.json",
    site: report.target,
    paths,
    rules,
  };
  if (report.pages.length && report.pages.every((p) => p.textLength >= 500)) {
    policy.page = { minTextWithoutJs: 500 };
  }
  return policy;
}
