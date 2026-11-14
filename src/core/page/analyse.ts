/** Page checks P1 to P5 over one fetched page. Pure: headers and HTML in, facts and findings out. */
import { parse } from "parse5";
import { findBot } from "../registry.js";
import type { Finding } from "../types.js";
import { parseDirectiveList, parseHeaderDirectives, summarise, type DirectiveSummary } from "./directives.js";

export type PageInput =
  | {
      kind: "response";
      url: string;
      finalUrl: string;
      status: number;
      headers: Record<string, string>;
      body: string;
      redirects: string[];
    }
  | { kind: "unreachable"; url: string; error: string; message: string };

export interface DirectiveSource {
  source: "header" | "meta";
  /** Lower-cased crawler name, or null for every crawler. */
  agent: string | null;
  directives: string[];
}

export interface PageReport {
  url: string;
  finalUrl: string | null;
  status: number | null;
  measured: boolean;
  isHtml: boolean;
  redirects: string[];
  directives: DirectiveSource[];
  dataNosnippetCount: number;
  canonical: string | null;
  textLength: number;
  jsonLd: { index: number; valid: boolean; types: string[]; error?: string }[];
  findings: Finding[];
}

export interface PageOptions {
  /** P4 threshold: characters of readable text expected without JavaScript. */
  minText?: number;
}

export const DEFAULT_MIN_TEXT = 500;

// Minimal shape of the parse5 default tree that this module walks.
interface Node {
  nodeName: string;
  tagName?: string;
  value?: string;
  attrs?: { name: string; value: string }[];
  childNodes?: Node[];
}

function attr(node: Node, name: string): string | undefined {
  return node.attrs?.find((a) => a.name === name)?.value;
}

function* walk(node: Node): Generator<Node> {
  yield node;
  for (const child of node.childNodes ?? []) yield* walk(child);
}

const SKIP_TEXT = new Set(["script", "style", "template", "svg", "head", "iframe", "object"]);

function readableText(node: Node): string {
  if (node.nodeName === "#text") return node.value ?? "";
  if (node.tagName && SKIP_TEXT.has(node.tagName)) return "";
  return (node.childNodes ?? []).map(readableText).join(" ");
}

function textOf(node: Node): string {
  return (node.childNodes ?? []).map((c) => (c.nodeName === "#text" ? (c.value ?? "") : textOf(c))).join("");
}

function collectTypes(value: unknown, out: string[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectTypes(item, out);
    return;
  }
  if (value === null || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  const type = record["@type"];
  if (typeof type === "string") out.push(type);
  else if (Array.isArray(type)) out.push(...type.filter((t): t is string => typeof t === "string"));
  if (record["@graph"] !== undefined) collectTypes(record["@graph"], out);
}

function linkHeaderCanonical(link: string | undefined): string | null {
  if (!link) return null;
  for (const part of link.split(/,(?=\s*<)/)) {
    const match = part.match(/<([^>]+)>(.*)$/);
    if (match && /rel\s*=\s*"?[^";]*\bcanonical\b/i.test(match[2]!)) return match[1]!;
  }
  return null;
}

function absolute(href: string, base: string): string | null {
  try {
    const url = new URL(href, base);
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

function botLabel(agent: string | null): string {
  if (agent === null) return "*";
  return findBot(agent)?.token ?? agent;
}

/** The page-level controls that apply to one crawler: those for every crawler plus those naming it. */
export function directivesFor(report: PageReport, token: string): DirectiveSummary {
  const name = token.toLowerCase();
  return summarise(report.directives.filter((d) => d.agent === null || d.agent === name).flatMap((d) => d.directives));
}

const RESTRICTIVE = (directives: string[]) =>
  directives.filter((d) => d === "noindex" || d === "none" || d === "nosnippet" || d.startsWith("max-snippet:"));

export function analysePage(input: PageInput, options: PageOptions = {}): PageReport {
  const report: PageReport = {
    url: input.url,
    finalUrl: null,
    status: null,
    measured: false,
    isHtml: false,
    redirects: [],
    directives: [],
    dataNosnippetCount: 0,
    canonical: null,
    textLength: 0,
    jsonLd: [],
    findings: [],
  };

  if (input.kind === "unreachable") {
    report.findings.push({
      check: "P3", layer: "page", severity: "error", bots: ["*"], path: input.url,
      message: `The page could not be fetched (${input.error}: ${input.message}). Not measured.`,
    });
    return report;
  }

  report.measured = true;
  report.finalUrl = input.finalUrl;
  report.status = input.status;
  report.redirects = input.redirects;
  const contentType = input.headers["content-type"] ?? "";
  report.isHtml = /html/i.test(contentType) || (contentType === "" && /^\s*</.test(input.body));

  // P1: X-Robots-Tag applies to any content type.
  const header = input.headers["x-robots-tag"];
  if (header) {
    for (const scoped of parseHeaderDirectives(header)) {
      report.directives.push({ source: "header", ...scoped });
      const restrictive = RESTRICTIVE(scoped.directives);
      if (restrictive.length) {
        report.findings.push({
          check: "P1", layer: "page", severity: "warning", bots: [botLabel(scoped.agent)], path: input.url,
          message: `X-Robots-Tag ${scoped.agent ? `for ${scoped.agent} ` : ""}sets ${restrictive.join(", ")}.`,
        });
      }
    }
  }

  // P3: status and redirects.
  if (input.status < 200 || input.status >= 300) {
    report.findings.push({
      check: "P3", layer: "page", severity: "error", bots: ["*"], path: input.url,
      message: `The page returned ${input.status}.`,
    });
  }
  if (input.redirects.length) {
    report.findings.push({
      check: "P3", layer: "page", severity: "info", bots: ["*"], path: input.url,
      message: `The page redirects ${input.redirects.length === 1 ? "once" : `${input.redirects.length} times`}, ending at ${input.finalUrl}.`,
    });
  }

  const headerCanonical = linkHeaderCanonical(input.headers["link"]);
  if (!report.isHtml) {
    report.canonical = headerCanonical ? absolute(headerCanonical, input.finalUrl) : null;
    canonicalFinding(report, input);
    return report;
  }

  // scriptingEnabled: false parses <noscript> as markup, as a crawler without JavaScript sees it.
  const document = parse(input.body, { scriptingEnabled: false }) as unknown as Node;
  let htmlCanonical: string | null = null;
  for (const node of walk(document)) {
    if (!node.tagName) continue;
    if (node.attrs?.some((a) => a.name === "data-nosnippet")) report.dataNosnippetCount++;
    if (node.tagName === "meta") {
      const name = attr(node, "name")?.trim().toLowerCase();
      const content = attr(node, "content");
      if (!name || content === undefined) continue;
      const agent = name === "robots" ? null : findBot(name) ? name : null;
      if (name !== "robots" && agent === null) continue;
      const directives = parseDirectiveList(content);
      report.directives.push({ source: "meta", agent, directives });
      const restrictive = RESTRICTIVE(directives);
      if (restrictive.length) {
        report.findings.push({
          check: "P2", layer: "page", severity: "warning", bots: [botLabel(agent)], path: input.url,
          message: `<meta name="${name}"> sets ${restrictive.join(", ")}.`,
        });
      }
    }
    if (node.tagName === "link" && htmlCanonical === null) {
      const rel = (attr(node, "rel") ?? "").toLowerCase().split(/\s+/);
      const href = attr(node, "href");
      if (rel.includes("canonical") && href) htmlCanonical = href;
    }
    if (node.tagName === "script" && (attr(node, "type") ?? "").trim().toLowerCase() === "application/ld+json") {
      const index = report.jsonLd.length;
      try {
        const types: string[] = [];
        collectTypes(JSON.parse(textOf(node)), types);
        report.jsonLd.push({ index, valid: true, types });
        if (types.length === 0) {
          report.findings.push({
            check: "P5", layer: "page", severity: "warning", bots: ["*"], path: input.url,
            message: `JSON-LD block ${index + 1} parses but declares no @type.`,
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        report.jsonLd.push({ index, valid: false, types: [], error: message });
        report.findings.push({
          check: "P5", layer: "page", severity: "warning", bots: ["*"], path: input.url,
          message: `JSON-LD block ${index + 1} does not parse: ${message}`,
        });
      }
    }
  }

  if (report.dataNosnippetCount > 0) {
    report.findings.push({
      check: "P2", layer: "page", severity: "info", bots: ["*"], path: input.url,
      message: `${report.dataNosnippetCount} element${report.dataNosnippetCount === 1 ? "" : "s"} marked data-nosnippet.`,
    });
  }

  const canonical = htmlCanonical ?? headerCanonical;
  report.canonical = canonical ? absolute(canonical, input.finalUrl) : null;
  canonicalFinding(report, input);

  // P4: readable text in the raw HTML.
  report.textLength = readableText(document).replace(/\s+/g, " ").trim().length;
  const minText = options.minText ?? DEFAULT_MIN_TEXT;
  if (input.status >= 200 && input.status < 300 && report.textLength < minText) {
    report.findings.push({
      check: "P4", layer: "page", severity: "warning", bots: ["*"], path: input.url,
      message: `Only ${report.textLength} characters of text without JavaScript (expected at least ${minText}). Crawlers that do not run scripts see little or nothing.`,
    });
  }
  return report;
}

function canonicalFinding(report: PageReport, input: Extract<PageInput, { kind: "response" }>): void {
  const self = absolute(input.finalUrl, input.finalUrl);
  if (report.canonical && self && report.canonical !== self) {
    report.findings.push({
      check: "P3", layer: "page", severity: "warning", bots: ["*"], path: input.url,
      message: `The canonical URL points elsewhere: ${report.canonical}.`,
    });
  }
}
