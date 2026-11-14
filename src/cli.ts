#!/usr/bin/env node
import { existsSync, realpathSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { BOTS } from "./core/registry.js";
import { notMeasured } from "./core/report/build.js";
import { annotations, auditMarkdown, auditText } from "./core/report/format.js";
import type { Report } from "./core/report/schema.js";
import { robotsText } from "./core/report/robots-text.js";
import type { BotRecord } from "./core/types.js";
import { createFetcher, type Fetcher } from "./net/fetcher.js";
import { InputError, runAudit, runInit, runRobots, runTest } from "./runner.js";
import { userAgent, version } from "./version.js";

export interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

export const EXIT = { ok: 0, policyBroken: 1, badInput: 2, notMeasured: 3 } as const;

export { userAgent, version };

const USAGE = `Usage: botpolicy <command> [options]

Commands:
  audit <url>            What each crawler can reach: robots.txt and page checks
  test [url]             Check the site (or another URL, such as a preview) against botpolicy.json
  init <url>             Write botpolicy.json from what the site does today
  robots <url or file>   robots.txt verdicts per crawler, with the deciding line
  bots                   List the crawler registry with sources
  mcp                    Start the read-only MCP server over stdio

Options:
  --path <path>   Path to check (repeatable; default "/")
  --format <f>    text, markdown or json (audit; default text)
  --json          Machine-readable output (same as --format json)
  --policy <file> Policy file for test (default botpolicy.json)
  --out <file>    Where init writes the policy (default botpolicy.json)
  --force         Let init overwrite an existing file
  --annotate      Print GitHub Actions error annotations for broken rules (test)
  --probe         Also request each path as each crawler, one a second (simulated; audit, test)
  --bots <list>   Comma-separated crawlers to probe (default: every crawler with a published user agent)
  -v, --version   Print the version
  -h, --help      Print this help
`;

function bad(message: string): CliResult {
  return { code: EXIT.badInput, stdout: "", stderr: `botpolicy: ${message}\n` };
}

function formatBots(bots: readonly BotRecord[]): string {
  const rows = bots.map((b) => [
    b.token,
    b.operator,
    b.purpose,
    b.isCrawler ? b.obeysRobots : "control only",
    b.verified ?? "UNVERIFIED",
    b.docsUrl ?? "",
  ]);
  const head = ["TOKEN", "OPERATOR", "PURPOSE", "OBEYS ROBOTS.TXT", "VERIFIED", "SOURCE"];
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)));
  const line = (cells: string[]) =>
    cells.map((c, i) => (i === cells.length - 1 ? c : c.padEnd(widths[i]!))).join("  ");
  return [line(head), ...rows.map(line)].join("\n") + "\n";
}


export interface CliDeps {
  fetcher?: Fetcher;
  /** Writes the policy file for init; replaced in tests. */
  writeFile?: (path: string, text: string) => void;
  exists?: (path: string) => boolean;
  /** The report time; replaced in tests. */
  now?: () => Date;
}

function render(report: Report, format: string): string {
  if (format === "json") return JSON.stringify(report, null, 2) + "\n";
  return format === "markdown" ? auditMarkdown(report, BOTS) : auditText(report, BOTS);
}

/** Runs the CLI on the given arguments without touching the process. */
export async function run(argv: string[], deps: CliDeps = {}): Promise<CliResult> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: {
        version: { type: "boolean", short: "v" },
        help: { type: "boolean", short: "h" },
        json: { type: "boolean" },
        path: { type: "string", multiple: true },
        format: { type: "string" },
        policy: { type: "string" },
        out: { type: "string" },
        force: { type: "boolean" },
        annotate: { type: "boolean" },
        probe: { type: "boolean" },
        bots: { type: "string" },
      },
      allowPositionals: true,
    });
  } catch (error) {
    return bad(error instanceof Error ? error.message : String(error));
  }
  const { values, positionals } = parsed;
  if (values.version) return { code: EXIT.ok, stdout: `${version()}\n`, stderr: "" };
  const [command, ...rest] = positionals;
  const probeOptions = {
    probe: !!values.probe,
    probeBots: values.bots ? values.bots.split(",").map((t) => t.trim()).filter(Boolean) : undefined,
  };
  if (values.bots && !values.probe) return bad("--bots only applies with --probe");
  if (values.help || command === undefined) return { code: EXIT.ok, stdout: USAGE, stderr: "" };

  switch (command) {
    case "bots":
      if (rest.length > 0) return bad(`bots takes no arguments`);
      return {
        code: EXIT.ok,
        stdout: values.json ? JSON.stringify(BOTS, null, 2) + "\n" : formatBots(BOTS),
        stderr: "",
      };
    case "audit": {
      if (rest.length !== 1) return bad("audit takes one URL");
      const format = values.json ? "json" : (values.format ?? "text");
      if (!["text", "markdown", "json"].includes(format)) return bad(`unknown format '${format}'`);
      try {
        const report = await runAudit(rest[0]!, values.path ?? ["/"], {
          fetcher: deps.fetcher ?? createFetcher({ userAgent: userAgent() }),
        }, { version: version(), now: deps.now, ...probeOptions });
        const stdout =
          format === "json" ? JSON.stringify(report, null, 2) + "\n" :
          format === "markdown" ? auditMarkdown(report, BOTS) : auditText(report, BOTS);
        return { code: notMeasured(report) ? EXIT.notMeasured : EXIT.ok, stdout, stderr: "" };
      } catch (error) {
        if (error instanceof InputError) return bad(error.message);
        throw error;
      }
    }
    case "test": {
      if (rest.length > 1) return bad("test takes at most one URL");
      const format = values.json ? "json" : (values.format ?? "text");
      if (!["text", "markdown", "json"].includes(format)) return bad(`unknown format '${format}'`);
      try {
        const report = await runTest(values.policy ?? "botpolicy.json", rest[0], {
          fetcher: deps.fetcher ?? createFetcher({ userAgent: userAgent() }),
        }, { version: version(), now: deps.now, ...probeOptions });
        const status = report.policy!.status;
        const code = status === "fail" ? EXIT.policyBroken : status === "not-measured" ? EXIT.notMeasured : EXIT.ok;
        return { code, stdout: render(report, format) + (values.annotate ? annotations(report) : ""), stderr: "" };
      } catch (error) {
        if (error instanceof InputError) return bad(error.message);
        throw error;
      }
    }
    case "init": {
      if (rest.length !== 1) return bad("init takes one URL");
      const out = values.out ?? "botpolicy.json";
      const exists = deps.exists ?? existsSync;
      if (exists(out) && !values.force) return bad(`${out} already exists; pass --force to overwrite it`);
      try {
        const { report, policy } = await runInit(rest[0]!, values.path ?? ["/"], {
          fetcher: deps.fetcher ?? createFetcher({ userAgent: userAgent() }),
        }, { version: version() });
        if (!policy) {
          return { code: EXIT.notMeasured, stdout: auditText(report, BOTS), stderr: `botpolicy: not everything could be measured, so no policy was written.\n` };
        }
        (deps.writeFile ?? ((p, t) => writeFileSync(p, t)))(out, JSON.stringify(policy, null, 2) + "\n");
        return { code: EXIT.ok, stdout: `Wrote ${out} with ${policy.rules.length} rules from what ${policy.site} does today. Review it, then run botpolicy test.\n`, stderr: "" };
      } catch (error) {
        if (error instanceof InputError) return bad(error.message);
        throw error;
      }
    }
    case "robots": {
      if (rest.length !== 1) return bad("robots takes one URL or file");
      const paths = values.path ?? ["/"];
      try {
        const report = await runRobots(rest[0]!, paths, {
          fetcher: deps.fetcher ?? createFetcher({ userAgent: userAgent() }),
        });
        return {
          code: report.status === "not-measured" ? EXIT.notMeasured : EXIT.ok,
          stdout: values.json ? JSON.stringify(report, null, 2) + "\n" : robotsText(report, BOTS),
          stderr: "",
        };
      } catch (error) {
        if (error instanceof InputError) return bad(error.message);
        throw error;
      }
    }
    case "mcp":
      return bad("mcp starts a server and must be run as its own process: botpolicy mcp");
    default:
      return bad(`unknown command '${command}'. Run botpolicy --help.`);
  }
}

const entry = process.argv[1];
if (entry && realpathSync(entry) === fileURLToPath(import.meta.url) && process.argv[2] === "mcp" && process.argv.length === 3) {
  void import("./mcp.js").then((m) => m.startStdio());
} else if (entry && realpathSync(entry) === fileURLToPath(import.meta.url)) {
  run(process.argv.slice(2)).then(
    (result) => {
      process.stdout.write(result.stdout);
      process.stderr.write(result.stderr);
      process.exitCode = result.code;
    },
    (error: unknown) => {
      process.stderr.write(`botpolicy: unexpected error: ${error instanceof Error ? error.stack : String(error)}\n`);
      process.exitCode = 2;
    },
  );
}
