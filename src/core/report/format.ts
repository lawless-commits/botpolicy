/** Terminal text and Markdown for an audit report. Pure. */
import type { BotRecord } from "../types.js";
import type { Report } from "./schema.js";

const LABEL = { allowed: "allowed", blocked: "BLOCKED", restricted: "restricted", "not-measured": "not measured" } as const;

function decidedBy(v: Report["verdicts"][number]): string {
  if (v.decidedBy === "robots") {
    if (v.robots.verdict === "not-measured") return "robots.txt not measured";
    return `robots.txt line ${v.robots.line}: ${v.robots.ruleText}${v.robots.managed ? ` [${v.robots.managed}]` : ""}`;
  }
  if (v.decidedBy === "edge") {
    const status = v.edge!.status !== null ? `HTTP ${v.edge!.status}` : "";
    return `edge: ${[v.edge!.class === "challenged" ? "challenge" : "", status].filter(Boolean).join(", ")} (simulated)`;
  }
  if (v.decidedBy === "page") return v.verdict === "not-measured" ? "page not measured" : `page: ${v.pageControls.join(", ")}`;
  return v.robots.line !== null ? `robots.txt line ${v.robots.line}: ${v.robots.ruleText}` : "";
}

function rows(report: Report, bots: readonly BotRecord[], path: string): string[][] {
  const purpose = new Map(bots.map((b) => [b.token, b.isCrawler ? b.purpose : `${b.purpose} (control)`]));
  return report.verdicts
    .filter((v) => v.path === path)
    .map((v) => [v.token, purpose.get(v.token) ?? "", LABEL[v.verdict], [decidedBy(v), v.notes.length ? "*" : ""].filter(Boolean).join(" ")]);
}

function textTable(head: string[], body: string[][]): string {
  const widths = head.map((h, i) => Math.max(h.length, ...body.map((r) => r[i]!.length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i]!)).join("  ").trimEnd();
  return [line(head), ...body.map(line)].join("\n");
}

function findingLine(f: Report["findings"][number]): string {
  const weight = f.evidence.weight ? f.evidence.level : "unproven, no weight";
  return `[${f.severity}] ${f.check}${f.path ? ` ${f.path}` : ""}: ${f.message} (${weight})`;
}

/** Each distinct note once, with the crawlers it applies to. */
function notes(report: Report): string[] {
  const byNote = new Map<string, string[]>();
  for (const v of report.verdicts) {
    for (const n of v.notes) {
      const tokens = byNote.get(n) ?? [];
      if (!tokens.includes(v.token)) tokens.push(v.token);
      byNote.set(n, tokens);
    }
  }
  return [...byNote].map(([note, tokens]) => `${tokens.join(", ")}: ${note}`);
}

const HEAD = ["CRAWLER", "PURPOSE", "VERDICT", "DECIDED BY"];

export function auditText(report: Report, bots: readonly BotRecord[]): string {
  const out = [`botpolicy ${report.tool.version}  ${report.target}  ${report.generatedAt}  (${report.requests} requests)`];
  const r = report.robots;
  if (report.probe) out.push(`Probe: SIMULATED. ${report.probe.note}`);
  out.push(`robots.txt: ${r.status === "parsed" ? `HTTP ${r.httpStatus}` : r.status === "absent" ? `none (${r.httpStatus})` : "NOT MEASURED"}`);
  for (const page of report.pages) {
    out.push("", `Path ${page.path}  ${page.measured ? `HTTP ${page.status}, ${page.textLength} characters without JavaScript` : "NOT MEASURED"}`);
    out.push(textTable(HEAD, rows(report, bots, page.path)));
  }
  const n = notes(report);
  if (n.length) out.push("", "Notes (*)", ...n.map((x) => `  ${x}`));
  if (report.findings.length) out.push("", "Findings", ...report.findings.map((f) => `  ${findingLine(f)}`));
  const policy = policyLines(report);
  if (policy.length) out.push("", policy[1]!, ...policy.slice(2).map((l) => `  ${l}`));
  return out.join("\n") + "\n";
}

const POLICY_STATUS = { pass: "PASS", fail: "FAIL", "not-measured": "NOT MEASURED" } as const;

/** Policy results: failures first, then not measured, then a count of what held. */
function policyLines(report: Report): string[] {
  const p = report.policy;
  if (!p) return [];
  const all = [...p.checks, ...p.pageChecks];
  const broken = all.filter((c) => c.ok === false);
  const unmeasured = all.filter((c) => c.ok === null);
  const held = all.length - broken.length - unmeasured.length;
  return [
    "",
    `Policy ${p.file}: ${POLICY_STATUS[p.status]} (${held} held, ${broken.length} broken, ${unmeasured.length} not measured)`,
    ...broken.map((c) => `BROKEN  ${c.reason}`),
    ...unmeasured.map((c) => `NOT MEASURED  ${c.reason}`),
  ];
}

/** GitHub Actions error annotations, one per broken expectation. */
export function annotations(report: Report): string {
  const p = report.policy;
  if (!p) return "";
  const esc = (s: string) => s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
  return [...p.checks, ...p.pageChecks]
    .filter((c) => c.ok === false)
    .map((c) => `::error title=botpolicy::${esc(c.reason)}\n`)
    .join("");
}

const cell = (s: string) => s.replace(/\|/g, "\\|");

export function auditMarkdown(report: Report, bots: readonly BotRecord[]): string {
  const out = [`# botpolicy audit: ${report.target}`, "", `Version ${report.tool.version}, ${report.generatedAt}, ${report.requests} requests.`];
  if (report.probe) out.push("", `> **Probe: simulated.** ${report.probe.note}`);
  for (const page of report.pages) {
    out.push("", `## \`${page.path}\``, "", page.measured ? `HTTP ${page.status}, ${page.textLength} characters of text without JavaScript.` : "**Not measured.**", "");
    out.push(`| ${HEAD.join(" | ")} |`, `| ${HEAD.map(() => "---").join(" | ")} |`);
    for (const row of rows(report, bots, page.path)) out.push(`| ${row.map(cell).join(" | ")} |`);
  }
  const n = notes(report);
  if (n.length) out.push("", "### Notes", "", ...n.map((x) => `- ${cell(x)}`));
  if (report.findings.length) {
    out.push("", "## Findings", "");
    for (const f of report.findings) out.push(`- ${findingLine(f).replace(/^\[(\w+)\]/, "**$1**")} [source](${f.evidence.source})`);
  }
  const lines = policyLines(report);
  if (lines.length) {
    out.push("", `## ${lines[1]}`, "");
    for (const l of lines.slice(2)) out.push(`- ${cell(l)}`);
  }
  return out.join("\n") + "\n";
}
