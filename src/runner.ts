/** Turns a command into requests and core calls. The only layer that joins network or disk to the core. */
import { readFile } from "node:fs/promises";
import { analyseRobots, type RobotsInput, type RobotsReport } from "./core/robots/checks.js";
import { BOTS } from "./core/registry.js";
import type { BotRecord } from "./core/types.js";
import type { Fetcher } from "./net/fetcher.js";

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
