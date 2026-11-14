import evidence from "../data/evidence.json" with { type: "json" };

export type EvidenceLevel = "documented" | "measured" | "unproven";

export interface Evidence {
  title: string;
  level: EvidenceLevel;
  source: string;
  sourceName: string;
  checked: string;
  basis: string;
}

/** One entry per check in the catalogue. */
export const EVIDENCE: Readonly<Record<string, Evidence>> = evidence as Record<string, Evidence>;

/** Unproven checks are reported but never weigh on a verdict or a policy result. */
export function carriesWeight(check: string): boolean {
  const entry = EVIDENCE[check];
  return entry !== undefined && entry.level !== "unproven";
}
