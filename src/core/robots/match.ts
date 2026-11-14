/** RFC 9309 matching: group selection, longest match, allow on a tie, and the deciding line. */
import { productToken, type ParsedRobots, type RobotsRule } from "./parse.js";

export type RobotsReason =
  | "rule-matched"
  | "no-rule-matched"
  | "no-group"
  | "robots-txt-always-allowed";

export interface RobotsVerdict {
  verdict: "allowed" | "blocked";
  /** The rule that decided the verdict; null when none matched. */
  rule: RobotsRule | null;
  /** Which group applied: one the crawler is named in, the * group, or none. */
  group: { kind: "named" | "star" | "none"; lines: number[] };
  reason: RobotsReason;
}

const UNRESERVED = /[A-Za-z0-9\-._~]/;

/**
 * Brings a path or pattern to one form so the two can be compared:
 * non-ASCII and spaces percent-encoded as UTF-8, hex upper-cased,
 * and percent-encoded unreserved characters decoded.
 */
export function normalisePath(input: string): string {
  const withoutFragment = input.split("#")[0]!;
  let out = "";
  for (let i = 0; i < withoutFragment.length; ) {
    const ch = withoutFragment[i]!;
    const hex = withoutFragment.slice(i + 1, i + 3);
    if (ch === "%" && /^[0-9A-Fa-f]{2}$/.test(hex)) {
      const decoded = String.fromCharCode(parseInt(hex, 16));
      out += UNRESERVED.test(decoded) ? decoded : `%${hex.toUpperCase()}`;
      i += 3;
      continue;
    }
    const codePoint = withoutFragment.codePointAt(i)!;
    const char = String.fromCodePoint(codePoint);
    if (codePoint > 0x7e || codePoint <= 0x20) {
      for (const byte of new TextEncoder().encode(char)) {
        out += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
      }
    } else {
      out += char;
    }
    i += char.length;
  }
  return out === "" ? "/" : out;
}

function patternMatches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const source = body
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${source}${anchored ? "$" : ""}`).test(path);
}

export function evaluate(parsed: ParsedRobots, crawlerToken: string, path: string): RobotsVerdict {
  const token = productToken(crawlerToken);
  const named = parsed.groups.filter((g) => g.agents.some((a) => a.token === token));
  const chosen = named.length > 0 ? named : parsed.groups.filter((g) => g.agents.some((a) => a.token === "*"));
  const group: RobotsVerdict["group"] = {
    kind: named.length > 0 ? "named" : chosen.length > 0 ? "star" : "none",
    lines: chosen.map((g) => g.agents[0]!.line),
  };

  const target = normalisePath(path);
  if (target === "/robots.txt") {
    return { verdict: "allowed", rule: null, group, reason: "robots-txt-always-allowed" };
  }
  if (group.kind === "none") return { verdict: "allowed", rule: null, group, reason: "no-group" };

  let best: { rule: RobotsRule; length: number } | null = null;
  for (const rule of chosen.flatMap((g) => g.rules)) {
    if (rule.pattern === "") continue;
    const pattern = normalisePath(rule.pattern);
    if (!patternMatches(pattern, target)) continue;
    const length = pattern.length;
    const better =
      !best ||
      length > best.length ||
      (length === best.length && rule.directive === "allow" && best.rule.directive === "disallow");
    if (better) best = { rule, length };
  }

  if (!best) return { verdict: "allowed", rule: null, group, reason: "no-rule-matched" };
  return {
    verdict: best.rule.directive === "allow" ? "allowed" : "blocked",
    rule: best.rule,
    group,
    reason: "rule-matched",
  };
}
