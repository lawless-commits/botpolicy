/** Aggregates survey reports into one row per crawler. Pure, so anyone rerunning gets the same table. */
import type { Report } from "../report/schema.js";

export interface SurveyRow {
  token: string;
  /** Sites where both robots.txt and the probe were measured. */
  measured: number;
  robotsBlocks: number;
  /** robots.txt blocks it, but the site served it the page (simulated). */
  blockedButServed: number;
  robotsAllows: number;
  /** robots.txt allows it, but the site denied or challenged it (simulated). */
  allowedButRefused: number;
}

export function summariseSurvey(reports: Pick<Report, "target" | "verdicts">[]): SurveyRow[] {
  const rows = new Map<string, SurveyRow>();
  for (const report of reports) {
    for (const v of report.verdicts) {
      if (v.path !== "/" || !v.edge) continue;
      const row = rows.get(v.token) ?? { token: v.token, measured: 0, robotsBlocks: 0, blockedButServed: 0, robotsAllows: 0, allowedButRefused: 0 };
      rows.set(v.token, row);
      if (v.robots.verdict === "not-measured" || v.edge.class === "not-measured") continue;
      row.measured++;
      if (v.robots.verdict === "blocked") {
        row.robotsBlocks++;
        if (v.edge.class === "served") row.blockedButServed++;
      } else {
        row.robotsAllows++;
        if (v.edge.class === "denied" || v.edge.class === "challenged") row.allowedButRefused++;
      }
    }
  }
  return [...rows.values()];
}

export function surveyMarkdown(rows: SurveyRow[], sites: number): string {
  const pct = (n: number, d: number) => (d === 0 ? "n/a" : `${n} of ${d} (${((100 * n) / d).toFixed(1)}%)`);
  return [
    `Sites surveyed: ${sites}. Every probe result is simulated: the requests came from one machine using each crawler's published user agent.`,
    "",
    "| Crawler | Measured | robots.txt blocks, site serves it | robots.txt allows, site refuses it |",
    "| --- | --- | --- | --- |",
    ...rows.map((r) => `| ${r.token} | ${r.measured} | ${pct(r.blockedButServed, r.robotsBlocks)} | ${pct(r.allowedButRefused, r.robotsAllows)} |`),
  ].join("\n") + "\n";
}
