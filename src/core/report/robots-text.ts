/** Terminal text for the robots command. Pure. */
import type { RobotsReport } from "../robots/checks.js";
import type { BotRecord } from "../types.js";

function table(head: string[], rows: string[][]): string {
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)));
  const line = (cells: string[]) =>
    cells.map((c, i) => (i === cells.length - 1 ? c : c.padEnd(widths[i]!))).join("  ").trimEnd();
  return [line(head), ...rows.map(line)].join("\n");
}

const VERDICT_LABEL = { allowed: "allowed", blocked: "BLOCKED", "not-measured": "not measured" } as const;

export function robotsText(report: RobotsReport, bots: readonly BotRecord[]): string {
  const out: string[] = [];
  const status =
    report.status === "not-measured"
      ? "NOT MEASURED"
      : report.status === "absent"
        ? `no robots.txt (${report.httpStatus})`
        : report.httpStatus === null
          ? "read from file"
          : `HTTP ${report.httpStatus}`;
  out.push(`robots.txt  ${report.finalUrl ?? report.url}  ${status}`);

  const purpose = new Map(bots.map((b) => [b.token, b.isCrawler ? b.purpose : `${b.purpose} (control)`]));
  const paths = [...new Set(report.verdicts.map((v) => v.path))];
  for (const path of paths) {
    out.push("", `Path ${path}`);
    const rows = report.verdicts
      .filter((v) => v.path === path)
      .map((v) => {
        let decided =
          v.line !== null ? `line ${v.line}: ${v.ruleText}` :
          v.reason === "no-group" ? "no group applies" :
          v.reason === "no-rule-matched" ? "no rule matched" :
          v.reason === "no-robots-txt" ? "no robots.txt" :
          v.reason === "robots-txt-always-allowed" ? "robots.txt is always allowed" : "";
        if (v.managed) decided += `  [${v.managed}]`;
        if (v.note) decided += "  *";
        return [v.token, purpose.get(v.token) ?? "", VERDICT_LABEL[v.verdict], decided];
      });
    out.push(table(["CRAWLER", "PURPOSE", "VERDICT", "DECIDED BY"], rows));
  }
  const notes = [...new Set(report.verdicts.filter((v) => v.note).map((v) => `* ${v.token}: ${v.note}`))];
  if (notes.length) out.push("", ...notes);

  if (report.findings.length) {
    out.push("", "Findings");
    for (const f of report.findings) {
      out.push(`  [${f.severity}] ${f.check}${f.path ? ` ${f.path}` : ""}: ${f.message}`);
    }
  }
  return out.join("\n") + "\n";
}
