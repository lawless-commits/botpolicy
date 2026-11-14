/** Robots-layer checks R1 and R3 to R6. Pure: a fetched (or unreachable) robots.txt in, verdicts and findings out. */
import type { BotRecord, Finding } from "../types.js";
import { evaluate, type RobotsVerdict } from "./match.js";
import { parseRobots, type ParsedRobots, type RobotsRule } from "./parse.js";

export type RobotsInput =
  | { kind: "response"; url: string; finalUrl: string; status: number; contentType: string; body: string }
  | { kind: "unreachable"; url: string; error: string; message: string };

export interface RobotsPathVerdict {
  token: string;
  path: string;
  verdict: "allowed" | "blocked" | "not-measured";
  reason: RobotsVerdict["reason"] | "no-robots-txt" | "not-measured";
  /** Line number of the deciding rule, if one decided. */
  line: number | null;
  ruleText: string | null;
  managed: string | null;
  group: RobotsVerdict["group"] | null;
  note?: string;
}

export interface RobotsReport {
  url: string;
  finalUrl: string | null;
  httpStatus: number | null;
  /** parsed: a file was read. absent: the server said there is none (4xx). not-measured: no usable answer. */
  status: "parsed" | "absent" | "not-measured";
  verdicts: RobotsPathVerdict[];
  findings: Finding[];
  sitemaps: { url: string; line: number }[];
  contentSignals: { line: number; values: Record<string, string>; agents: string[] }[];
}

const RETIRED = ["anthropic-ai", "claude-web"];

function ruleText(rule: RobotsRule): string {
  return `${rule.directive === "allow" ? "Allow" : "Disallow"}: ${rule.pattern}`;
}

function looksLikeHtml(contentType: string, body: string): boolean {
  return /html/i.test(contentType) || /^\s*<(!doctype|html|head|body)\b/i.test(body);
}

function emptyReport(input: RobotsInput): RobotsReport {
  return {
    url: input.url,
    finalUrl: input.kind === "response" ? input.finalUrl : null,
    httpStatus: input.kind === "response" ? input.status : null,
    status: "parsed",
    verdicts: [],
    findings: [],
    sitemaps: [],
    contentSignals: [],
  };
}

function blanket(bots: readonly BotRecord[], paths: string[], verdict: "allowed" | "not-measured"): RobotsPathVerdict[] {
  return bots.flatMap((bot) =>
    paths.map((path) => ({
      token: bot.token,
      path,
      verdict,
      reason: verdict === "allowed" ? ("no-robots-txt" as const) : ("not-measured" as const),
      line: null,
      ruleText: null,
      managed: null,
      group: null,
    })),
  );
}

export function analyseRobots(input: RobotsInput, bots: readonly BotRecord[], paths: string[]): RobotsReport {
  const report = emptyReport(input);
  const allTokens = bots.map((b) => b.token);

  if (input.kind === "unreachable") {
    report.status = "not-measured";
    report.verdicts = blanket(bots, paths, "not-measured");
    report.findings.push({
      check: "R1", layer: "robots", severity: "error", bots: allTokens,
      message: `robots.txt could not be fetched (${input.error}: ${input.message}). Not measured.`,
    });
    return report;
  }

  const { status } = input;
  if (status >= 500) {
    report.status = "not-measured";
    report.verdicts = blanket(bots, paths, "not-measured");
    report.findings.push({
      check: "R1", layer: "robots", severity: "error", bots: allTokens,
      message: `robots.txt returned ${status}. Not measured. Under RFC 9309 a compliant crawler treats the whole site as disallowed while this lasts.`,
    });
    return report;
  }
  if (status >= 400) {
    report.status = "absent";
    report.verdicts = blanket(bots, paths, "allowed");
    const guarded = status === 401 || status === 403;
    report.findings.push({
      check: "R1", layer: "robots", severity: guarded ? "warning" : "info", bots: allTokens,
      message: guarded
        ? `robots.txt returned ${status}. RFC 9309 treats this as no robots.txt, so every crawler may fetch everything, but a ${status} often means a CDN or firewall is refusing requests like ours.`
        : `No robots.txt (${status}). Under RFC 9309 every crawler may fetch everything.`,
    });
    return report;
  }
  if (status < 200 || status >= 300) {
    report.status = "not-measured";
    report.verdicts = blanket(bots, paths, "not-measured");
    report.findings.push({
      check: "R1", layer: "robots", severity: "error", bots: allTokens,
      message: `robots.txt returned ${status}, which is not a final answer. Not measured.`,
    });
    return report;
  }

  let body = input.body;
  if (looksLikeHtml(input.contentType, body)) {
    report.findings.push({
      check: "R1", layer: "robots", severity: "warning", bots: allTokens,
      message: "robots.txt returned an HTML page, probably a catch-all route. It has no rules, so every crawler may fetch everything.",
    });
    body = "";
  }

  const parsed = parseRobots(body);
  report.sitemaps = parsed.sitemaps;
  report.contentSignals = parsed.groups.flatMap((g) =>
    g.contentSignals.map((s) => ({ line: s.line, values: s.values, agents: g.agents.map((a) => a.raw) })),
  );

  const results = new Map<string, RobotsVerdict>();
  for (const bot of bots) {
    for (const path of paths) {
      const result = evaluate(parsed, bot.token, path);
      results.set(`${bot.token}\n${path}`, result);
      const entry: RobotsPathVerdict = {
        token: bot.token,
        path,
        verdict: result.verdict,
        reason: result.reason,
        line: result.rule?.line ?? null,
        ruleText: result.rule ? ruleText(result.rule) : null,
        managed: result.rule?.managed ?? null,
        group: result.group,
      };
      if (bot.token === "Amzn-SearchBot" && result.group.kind !== "named") {
        entry.note = "Amazon says that when Amzn-SearchBot is not named it follows the rules given to other search crawlers, not the * group.";
      }
      report.verdicts.push(entry);
    }
  }

  report.findings.push(...shadowing(parsed, bots), ...retired(parsed));
  report.findings.push(...siblings(bots, paths, results));
  report.findings.push(...managedAndSignals(report));
  return report;
}

/** R3: a group that names a crawler replaces the * group, so * disallows no longer apply to it. */
function shadowing(parsed: ParsedRobots, bots: readonly BotRecord[]): Finding[] {
  const starDisallows = parsed.groups
    .filter((g) => g.agents.some((a) => a.token === "*"))
    .flatMap((g) => g.rules)
    .filter((r) => r.directive === "disallow" && r.pattern !== "");
  if (starDisallows.length === 0) return [];

  const byGroup = new Map<string, Finding>();
  for (const bot of bots) {
    const result = evaluate(parsed, bot.token, "/");
    if (result.group.kind !== "named") continue;
    const key = result.group.lines.join(",");
    const existing = byGroup.get(key);
    if (existing) {
      existing.bots.push(bot.token);
      continue;
    }
    const lost = starDisallows.filter((rule) => {
      const probe = rule.pattern.split("*")[0]!.replace(/\$$/, "") || "/";
      return evaluate(parsed, bot.token, probe.startsWith("/") ? probe : `/${probe}`).verdict === "allowed";
    });
    if (lost.length === 0) continue;
    byGroup.set(key, {
      check: "R3", layer: "robots", severity: "warning", bots: [bot.token],
      lines: lost.map((r) => r.line),
      message: `The group at line ${result.group.lines.join(", ")} replaces the * group, so these * rules no longer apply: ${lost
        .map((r) => `line ${r.line} ${ruleText(r)}`)
        .join("; ")}.`,
    });
  }
  return [...byGroup.values()];
}

/** R4: rules for tokens the operator no longer lists. Unproven, so information only. */
function retired(parsed: ParsedRobots): Finding[] {
  const agents = parsed.groups.flatMap((g) => g.agents).filter((a) => RETIRED.includes(a.token));
  if (agents.length === 0) return [];
  return [{
    check: "R4", layer: "robots", severity: "info", bots: [...new Set(agents.map((a) => a.raw))],
    lines: agents.map((a) => a.line),
    message: `Rules name ${[...new Set(agents.map((a) => a.raw))].join(", ")}, which Anthropic's crawler page does not list.`,
  }];
}

/** A rule that shuts out the whole site rather than one area of it. */
function isSiteWide(rule: RobotsRule | null): boolean {
  return rule !== null && rule.directive === "disallow" && (rule.pattern === "/" || rule.pattern === "/*");
}

/**
 * R5: an operator's search or user crawler and its training crawler are handled in a way that looks unintended.
 * Only site-wide blocks count for the * case: blocking an area such as /admin/ for everyone is a normal choice.
 */
function siblings(bots: readonly BotRecord[], paths: string[], results: Map<string, RobotsVerdict>): Finding[] {
  const found = new Map<string, Finding & { paths: string[] }>();
  const add = (key: string, make: () => Finding, path: string) => {
    const existing = found.get(key);
    if (existing) existing.paths.push(path);
    else found.set(key, { ...make(), paths: [path] });
  };
  for (const operator of new Set(bots.map((b) => b.operator))) {
    const own = bots.filter((b) => b.operator === operator);
    const training = own.filter((b) => b.purpose === "training");
    const visible = own.filter((b) => b.purpose === "search" || b.purpose === "user-fetch");
    for (const t of training) {
      for (const v of visible) {
        for (const path of paths) {
          const tr = results.get(`${t.token}\n${path}`)!;
          const vr = results.get(`${v.token}\n${path}`)!;
          if (tr.group.kind === "named" && vr.group.kind === "star" && vr.verdict === "blocked" && isSiteWide(vr.rule)) {
            add(`star ${v.token} ${t.token}`, () => ({
              check: "R5", layer: "robots", severity: "warning", bots: [v.token, t.token], lines: [vr.rule!.line],
              message: `${v.token} (${v.purpose}) is shut out by the * group's ${vr.rule!.directive === "disallow" ? "Disallow" : "Allow"}: ${vr.rule!.pattern} at line ${vr.rule!.line}, while only ${t.token} (training) is named. If you meant to block training only, give ${v.token} its own group.`,
            }), path);
          } else if (vr.group.kind === "named" && vr.verdict === "blocked" && tr.group.kind !== "named" && tr.verdict === "allowed") {
            add(`named ${v.token} ${t.token}`, () => ({
              check: "R5", layer: "robots", severity: "warning", bots: [v.token, t.token], lines: vr.rule ? [vr.rule.line] : [],
              message: `${v.token} (${v.purpose}) is blocked by name, but ${t.token} (training) is allowed. Check that the right crawler was named.`,
            }), path);
          }
        }
      }
    }
  }
  return [...found.values()].map(({ paths: hit, ...finding }) => ({
    ...finding,
    message: `${finding.message} Paths: ${hit.join(", ")}.`,
  }));
}

/** R6: verdicts decided by a CDN-managed block, and Content-Signal lines. */
function managedAndSignals(report: RobotsReport): Finding[] {
  const findings: Finding[] = [];
  const bySection = new Map<string, Set<string>>();
  for (const v of report.verdicts) {
    if (v.managed && v.verdict === "blocked") {
      if (!bySection.has(v.managed)) bySection.set(v.managed, new Set());
      bySection.get(v.managed)!.add(v.token);
    }
  }
  for (const [section, tokens] of bySection) {
    findings.push({
      check: "R6", layer: "robots", severity: "info", bots: [...tokens],
      message: `A block marked "${section}" decides that these crawlers are blocked. It was probably added by a CDN, not written in the site's own file.`,
    });
  }
  for (const signal of report.contentSignals) {
    findings.push({
      check: "R6", layer: "robots", severity: "info", bots: signal.agents, lines: [signal.line],
      message: `Content-Signal at line ${signal.line}: ${Object.entries(signal.values).map(([k, v]) => `${k}=${v}`).join(", ")}.`,
    });
  }
  return findings;
}
