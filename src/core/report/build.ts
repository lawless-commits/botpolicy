/** Assembles the report from the layers. Pure: the time and version are passed in. */
import { EVIDENCE } from "../evidence.js";
import type { PageReport } from "../page/analyse.js";
import type { RobotsReport } from "../robots/checks.js";
import type { Finding } from "../types.js";
import type { Verdict } from "../verdict.js";
import { SCHEMA_VERSION, type Report, type ReportFinding } from "./schema.js";

export interface BuildInput {
  target: string;
  version: string;
  generatedAt: string;
  requests: number;
  robots: RobotsReport;
  pages: Record<string, PageReport>;
  verdicts: Verdict[];
  extraFindings?: Finding[];
  probed?: boolean;
}

export const PROBE_NOTE =
  "The probe requests used each crawler's published user agent but came from this machine, not the crawler's own IP addresses. Large CDNs check real crawlers by IP address, so a refusal here does not prove the real crawler is refused, and being served here does not prove it is served.";

function withEvidence(f: Finding): ReportFinding {
  const entry = EVIDENCE[f.check];
  if (!entry) throw new Error(`check ${f.check} has no evidence entry`);
  return { ...f, evidence: { level: entry.level, source: entry.source, weight: entry.level !== "unproven" } };
}

const SEVERITY = { error: 0, warning: 1, info: 2 } as const;

export function buildReport(input: BuildInput): Report {
  const { verdicts: _v, findings: robotFindings, ...robots } = input.robots;
  const pages = Object.entries(input.pages).map(([path, page]) => {
    const { findings: _f, ...rest } = page;
    return { path, ...rest };
  });
  const findings = [
    ...robotFindings,
    ...Object.values(input.pages).flatMap((p) => p.findings),
    ...(input.extraFindings ?? []),
  ]
    .map(withEvidence)
    .sort((a, b) => SEVERITY[a.severity] - SEVERITY[b.severity]);
  return {
    schemaVersion: SCHEMA_VERSION,
    tool: { name: "botpolicy", version: input.version },
    target: input.target,
    generatedAt: input.generatedAt,
    requests: input.requests,
    robots,
    pages,
    verdicts: input.verdicts,
    findings,
    ...(input.probed ? { probe: { enabled: true as const, simulated: true as const, note: PROBE_NOTE } } : {}),
  };
}

export function notMeasured(report: Report): boolean {
  return report.verdicts.some((v) => v.verdict === "not-measured");
}
