#!/usr/bin/env node
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { BOTS } from "./core/registry.js";
import { robotsText } from "./core/report/robots-text.js";
import type { BotRecord } from "./core/types.js";
import { createFetcher, type Fetcher } from "./net/fetcher.js";
import { InputError, runRobots } from "./runner.js";

export interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

export const EXIT = { ok: 0, policyBroken: 1, badInput: 2, notMeasured: 3 } as const;

export function version(): string {
  const pkg: unknown = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );
  return (pkg as { version: string }).version;
}

const USAGE = `Usage: botpolicy <command> [options]

Commands:
  robots <url or file>   robots.txt verdicts per crawler, with the deciding line
  bots                   List the crawler registry with sources

Options:
  --path <path>   Path to check (repeatable; default "/") (robots)
  --json          Machine-readable output
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

export function userAgent(): string {
  return `botpolicy/${version()} (+https://github.com/lawless-commits/botpolicy)`;
}

export interface CliDeps {
  fetcher?: Fetcher;
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
      },
      allowPositionals: true,
    });
  } catch (error) {
    return bad(error instanceof Error ? error.message : String(error));
  }
  const { values, positionals } = parsed;
  if (values.version) return { code: EXIT.ok, stdout: `${version()}\n`, stderr: "" };
  const [command, ...rest] = positionals;
  if (values.help || command === undefined) return { code: EXIT.ok, stdout: USAGE, stderr: "" };

  switch (command) {
    case "bots":
      if (rest.length > 0) return bad(`bots takes no arguments`);
      return {
        code: EXIT.ok,
        stdout: values.json ? JSON.stringify(BOTS, null, 2) + "\n" : formatBots(BOTS),
        stderr: "",
      };
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
    default:
      return bad(`unknown command '${command}'. Run botpolicy --help.`);
  }
}

const entry = process.argv[1];
if (entry && realpathSync(entry) === fileURLToPath(import.meta.url)) {
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
