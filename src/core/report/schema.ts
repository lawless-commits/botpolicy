/** The JSON report, defined once. schema/report.json is generated from this. */
import { z } from "zod";

export const SCHEMA_VERSION = 1;

const FindingSchema = z.object({
  check: z.string(),
  layer: z.enum(["robots", "page", "edge", "info"]),
  severity: z.enum(["error", "warning", "info"]),
  bots: z.array(z.string()),
  path: z.string().optional(),
  lines: z.array(z.number().int()).optional(),
  message: z.string(),
  evidence: z.object({
    level: z.enum(["documented", "measured", "unproven"]),
    source: z.string(),
    /** False for unproven checks: reported, never weighed. */
    weight: z.boolean(),
  }),
});

const VerdictSchema = z.object({
  token: z.string(),
  path: z.string(),
  verdict: z.enum(["allowed", "blocked", "restricted", "not-measured"]),
  decidedBy: z.enum(["robots", "page", "none"]),
  robots: z.object({
    verdict: z.enum(["allowed", "blocked", "not-measured"]),
    line: z.number().int().nullable(),
    ruleText: z.string().nullable(),
    managed: z.string().nullable(),
  }),
  pageControls: z.array(z.string()),
  notes: z.array(z.string()),
});

const PageSchema = z.object({
  path: z.string(),
  url: z.string(),
  finalUrl: z.string().nullable(),
  status: z.number().int().nullable(),
  measured: z.boolean(),
  isHtml: z.boolean(),
  redirects: z.array(z.string()),
  directives: z.array(
    z.object({ source: z.enum(["header", "meta"]), agent: z.string().nullable(), directives: z.array(z.string()) }),
  ),
  dataNosnippetCount: z.number().int(),
  canonical: z.string().nullable(),
  textLength: z.number().int(),
  jsonLd: z.array(
    z.object({ index: z.number().int(), valid: z.boolean(), types: z.array(z.string()), error: z.string().optional() }),
  ),
});

const RobotsSchema = z.object({
  url: z.string(),
  finalUrl: z.string().nullable(),
  httpStatus: z.number().int().nullable(),
  status: z.enum(["parsed", "absent", "not-measured"]),
  sitemaps: z.array(z.object({ url: z.string(), line: z.number().int() })),
  contentSignals: z.array(
    z.object({ line: z.number().int(), values: z.record(z.string(), z.string()), agents: z.array(z.string()) }),
  ),
});

const PolicyResultSchema = z.object({
  file: z.string(),
  status: z.enum(["pass", "fail", "not-measured"]),
  checks: z.array(
    z.object({
      token: z.string(),
      path: z.string(),
      rule: z.number().int(),
      expected: z.enum(["allowed", "blocked", "restricted", "reachable"]),
      actual: z.enum(["allowed", "blocked", "restricted", "not-measured"]),
      ok: z.boolean().nullable(),
      reason: z.string(),
    }),
  ),
  pageChecks: z.array(
    z.object({
      path: z.string(),
      requirement: z.enum(["minTextWithoutJs", "requireJsonLd"]),
      ok: z.boolean().nullable(),
      reason: z.string(),
    }),
  ),
});

export const ReportSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  tool: z.object({ name: z.literal("botpolicy"), version: z.string() }),
  target: z.string(),
  generatedAt: z.string(),
  requests: z.number().int(),
  robots: RobotsSchema,
  pages: z.array(PageSchema),
  verdicts: z.array(VerdictSchema),
  findings: z.array(FindingSchema),
  /** Present when the run checked a policy file (botpolicy test). */
  policy: PolicyResultSchema.optional(),
});

export type Report = z.infer<typeof ReportSchema>;
export type ReportFinding = z.infer<typeof FindingSchema>;

export function reportJsonSchema(): object {
  return {
    $id: "https://unpkg.com/botpolicy/schema/report.json",
    title: "botpolicy report",
    ...z.toJSONSchema(ReportSchema),
  };
}
