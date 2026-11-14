/**
 * The Phase 6b survey. Rerunnable by anyone:
 *   pnpm build && node dist/scripts/survey.js <sites.txt> <out-dir>
 * sites.txt has one origin per line (# comments allowed). For each site it runs a passive
 * audit of "/" plus a probe of a few crawlers, one request a second, within a small budget,
 * then writes <out-dir>/<host>.json and <out-dir>/summary.md. It writes nothing else.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { summariseSurvey, surveyMarkdown } from "../core/survey/summarise.js";
import type { Report } from "../core/report/schema.js";
import { createFetcher } from "../net/fetcher.js";
import { InputError, runAudit } from "../runner.js";
import { userAgent, version } from "../version.js";

/** Crawlers probed on each site: one training and one search crawler per operator that publishes user agents. */
export const SURVEY_BOTS = ["GPTBot", "OAI-SearchBot", "PerplexityBot", "CCBot", "Meta-ExternalAgent", "Amazonbot"];
/** Requests per site: robots.txt, the page, sitemap, llms.txt and one probe per crawler. */
export const SURVEY_BUDGET = 4 + SURVEY_BOTS.length;

async function main(listFile: string, outDir: string): Promise<void> {
  const sites = readFileSync(listFile, "utf8").split("\n").map((l) => l.replace(/#.*/, "").trim()).filter(Boolean);
  mkdirSync(outDir, { recursive: true });
  const reports: Report[] = [];
  for (const [i, site] of sites.entries()) {
    const fetcher = createFetcher({ userAgent: `${userAgent()} survey`, budget: SURVEY_BUDGET });
    try {
      const report = await runAudit(site, ["/"], { fetcher }, { version: version(), probe: true, probeBots: SURVEY_BOTS });
      reports.push(report);
      writeFileSync(join(outDir, `${new URL(site).host}.json`), JSON.stringify(report, null, 2) + "\n");
      console.error(`[${i + 1}/${sites.length}] ${site}: ${report.requests} requests`);
    } catch (error) {
      if (!(error instanceof InputError)) throw error;
      console.error(`[${i + 1}/${sites.length}] ${site}: skipped (${error.message})`);
    }
  }
  writeFileSync(join(outDir, "summary.md"), surveyMarkdown(summariseSurvey(reports), reports.length));
}

const [listFile, outDir] = process.argv.slice(2);
if (!listFile || !outDir) {
  console.error("usage: node dist/scripts/survey.js <sites.txt> <out-dir>");
  process.exit(2);
}
await main(listFile, outDir);
