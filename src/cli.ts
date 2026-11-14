#!/usr/bin/env node
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { BOTS } from "./core/registry.js";
import type { BotRecord } from "./core/types.js";

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
  bots            List the crawler registry with sources

Options:
  --json          Machine-readable output (bots)
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

/** Runs the CLI on the given arguments without touching the process. */
export function run(argv: string[]): CliResult {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: {
        version: { type: "boolean", short: "v" },
        help: { type: "boolean", short: "h" },
        json: { type: "boolean" },
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
    default:
      return bad(`unknown command '${command}'. Run botpolicy --help.`);
  }
}

const entry = process.argv[1];
if (entry && realpathSync(entry) === fileURLToPath(import.meta.url)) {
  const result = run(process.argv.slice(2));
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exitCode = result.code;
}
