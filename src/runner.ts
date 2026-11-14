/** Turns a command into requests and core calls. The only layer that joins network or disk to the core. */
import { readFile } from "node:fs/promises";
import { analysePage, type PageInput, type PageReport } from "./core/page/analyse.js";
import { buildReport } from "./core/report/build.js";
import type { Report } from "./core/report/schema.js";
import { analyseRobots, type RobotsInput, type RobotsReport } from "./core/robots/checks.js";
import { combine } from "./core/verdict.js";
import type { Finding } from "./core/types.js";
import { BOTS } from "./core/registry.js";
import type { BotRecord } from "./core/types.js";
import type { Fetcher, FetchResult } from "./net/fetcher.js";

/** Bad input from the user: a missing file, a bad URL, a bad path. Exit code 2. */
export class InputError extends Error {}

export interface RunnerDeps {
  fetcher: Fetcher;
  readFile?: (path: string) => Promise<string>;
  bots?: readonly BotRecord[];
}

export function isUrl(target: string): boolean {
  return /^https?:\/\//i.test(target);
}

export async function runRobots(target: string, paths: string[], deps: RunnerDeps): Promise<RobotsReport> {
  for (const path of paths) {
    if (!path.startsWith("/")) throw new InputError(`paths must start with "/": ${path}`);
  }
  const bots = deps.bots ?? BOTS;

  if (!isUrl(target)) {
    let body: string;
    try {
      body = await (deps.readFile ?? ((p) => readFile(p, "utf8")))(target);
    } catch (error) {
      throw new InputError(`cannot read ${target}: ${error instanceof Error ? error.message : String(error)}`);
    }
    const input: RobotsInput = { kind: "response", url: target, finalUrl: target, status: 200, contentType: "text/plain", body };
    return analyseRobots(input, bots, paths);
  }

  let robotsUrl: string;
  try {
    robotsUrl = new URL("/robots.txt", target).href;
  } catch {
    throw new InputError(`not a URL: ${target}`);
  }
  const result = await deps.fetcher.fetch(robotsUrl);
  const input: RobotsInput = result.ok
    ? {
        kind: "response",
        url: robotsUrl,
        finalUrl: result.finalUrl,
        status: result.status,
        contentType: result.headers["content-type"] ?? "",
        body: result.body,
      }
    : { kind: "unreachable", url: robotsUrl, error: result.error, message: result.message };
  return analyseRobots(input, bots, paths);
}

export interface AuditOptions {
  version: string;
  now?: () => Date;
  minText?: number;
}

function toPageInput(url: string, result: FetchResult): PageInput {
  return result.ok
    ? { kind: "response", url, finalUrl: result.finalUrl, status: result.status, headers: result.headers, body: result.body, redirects: result.redirects }
    : { kind: "unreachable", url, error: result.error, message: result.message };
}

/**
 * Plans and runs one passive audit: robots.txt, each path once, the first sitemap and
 * /llms.txt, all with the tool's own user agent. The requests are counted before any is sent.
 */
export async function runAudit(target: string, paths: string[], deps: RunnerDeps, options: AuditOptions): Promise<Report> {
  let origin: URL;
  try {
    origin = new URL(target);
  } catch {
    throw new InputError(`not a URL: ${target}`);
  }
  if (!isUrl(target)) throw new InputError(`audit needs an http or https URL: ${target}`);
  const unique = [...new Set(paths)];
  for (const path of unique) {
    if (!path.startsWith("/")) throw new InputError(`paths must start with "/": ${path}`);
  }
  const planned = 1 + unique.length + 2; // robots.txt, each path, one sitemap, llms.txt
  const budget = deps.fetcher.limits.budget - deps.fetcher.used();
  if (planned > budget) {
    throw new InputError(`this audit needs up to ${planned} requests but the budget is ${budget}. Check fewer paths.`);
  }
  const bots = deps.bots ?? BOTS;

  const robots = await runRobots(origin.origin, unique, deps);
  const pages: Record<string, PageReport> = {};
  for (const path of unique) {
    const url = new URL(path, origin).href;
    pages[path] = analysePage(toPageInput(url, await deps.fetcher.fetch(url)), { minText: options.minText });
  }

  const extra: Finding[] = [];
  // R7: sitemap declared and reachable.
  const sitemap = robots.sitemaps[0];
  if (robots.status === "parsed" && !sitemap) {
    extra.push({ check: "R7", layer: "robots", severity: "info", bots: ["*"], message: "robots.txt declares no sitemap." });
  } else if (sitemap) {
    const result = await deps.fetcher.fetch(sitemap.url);
    const reachable = (result.ok && result.status >= 200 && result.status < 300) || (!result.ok && result.error === "too-large");
    extra.push(
      reachable
        ? { check: "R7", layer: "robots", severity: "info", bots: ["*"], lines: [sitemap.line], message: `Sitemap at line ${sitemap.line} is reachable: ${sitemap.url}${result.ok ? "" : " (over 2 MB, not read)"}.` }
        : { check: "R7", layer: "robots", severity: "warning", bots: ["*"], lines: [sitemap.line], message: `Sitemap at line ${sitemap.line} is not reachable (${result.ok ? `HTTP ${result.status}` : result.error}): ${sitemap.url}.` },
    );
  }
  // I1: llms.txt, reported only.
  const llms = await deps.fetcher.fetch(new URL("/llms.txt", origin).href);
  const present = llms.ok && llms.status === 200 && !/html/i.test(llms.headers["content-type"] ?? "");
  extra.push({
    check: "I1", layer: "info", severity: "info", bots: ["*"],
    message: present ? "llms.txt is present." : "No llms.txt.",
  });

  return buildReport({
    target: origin.href,
    version: options.version,
    generatedAt: (options.now ?? (() => new Date()))().toISOString(),
    requests: deps.fetcher.used(),
    robots,
    pages,
    verdicts: combine(robots, pages, bots),
    extraFindings: extra,
  });
}
