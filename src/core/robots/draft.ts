/** Drafts robots.txt groups for a block list and an allow list. Pure: returns text, writes nothing. */
import { selects } from "../policy/evaluate.js";
import type { PolicyRule } from "../policy/schema.js";
import type { BotRecord } from "../types.js";

export function draftRobotsRules(
  block: PolicyRule["bots"] | undefined,
  allow: PolicyRule["bots"] | undefined,
  bots: readonly BotRecord[],
): string {
  const blocked = block ? bots.filter((b) => selects({ bots: block }, b)) : [];
  const allowed = allow ? bots.filter((b) => selects({ bots: allow }, b) && !blocked.includes(b)) : [];
  const out = [`# Drafted by botpolicy. Review before use; paste above your other groups.`];
  if (blocked.length) {
    out.push("", `# Blocked: ${typeof block === "string" ? block : "listed crawlers"}`);
    out.push(...blocked.map((b) => `User-agent: ${b.token}`), "Disallow: /");
  }
  if (allowed.length) {
    out.push("", `# Allowed: ${typeof allow === "string" ? allow : "listed crawlers"}`);
    out.push(...allowed.map((b) => `User-agent: ${b.token}`), "Allow: /");
  }
  const ignoring = [...blocked, ...allowed].filter((b) => b.obeysRobots === "no");
  if (ignoring.length) {
    out.push("", `# Note: ${ignoring.map((b) => b.token).join(", ")} may not follow robots.txt, by its operator's own account.`);
  }
  return out.join("\n") + "\n";
}
