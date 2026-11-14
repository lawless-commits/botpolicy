import { readFileSync } from "node:fs";

export function version(): string {
  const pkg: unknown = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  return (pkg as { version: string }).version;
}

/** The tool's own, honest user agent. */
export function userAgent(): string {
  return `botpolicy/${version()} (+https://github.com/lawless-commits/botpolicy)`;
}
