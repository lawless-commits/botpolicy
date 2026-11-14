#!/usr/bin/env node
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

export interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

export function version(): string {
  const pkg: unknown = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );
  return (pkg as { version: string }).version;
}

/** Runs the CLI on the given arguments without touching the process. */
export function run(argv: string[]): CliResult {
  try {
    parseArgs({
      args: argv,
      options: { version: { type: "boolean", short: "v" } },
      allowPositionals: false,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { code: 2, stdout: "", stderr: `botpolicy: ${message}\n` };
  }
  // Phase 0: no commands yet, so every valid invocation prints the version.
  return { code: 0, stdout: `${version()}\n`, stderr: "" };
}

const entry = process.argv[1];
if (entry && realpathSync(entry) === fileURLToPath(import.meta.url)) {
  const result = run(process.argv.slice(2));
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exitCode = result.code;
}
