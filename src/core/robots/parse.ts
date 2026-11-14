/** RFC 9309 robots.txt parser. Pure: text in, structure out, with a line number on everything. */

export interface RobotsRule {
  directive: "allow" | "disallow";
  pattern: string;
  line: number;
  /** Name of the CDN-managed block the rule sits in, if any. */
  managed?: string;
}

export interface ContentSignal {
  line: number;
  raw: string;
  values: Record<string, string>;
}

export interface RobotsGroup {
  /** `token` is the lower-cased product token, or "*". */
  agents: { token: string; raw: string; line: number }[];
  rules: RobotsRule[];
  contentSignals: ContentSignal[];
  other: { key: string; value: string; line: number }[];
}

export interface ParsedRobots {
  groups: RobotsGroup[];
  sitemaps: { url: string; line: number }[];
  managedSections: { name: string; start: number; end: number }[];
  /** Allow or Disallow lines before any User-agent; RFC 9309 gives them no effect. */
  orphanRules: RobotsRule[];
  invalidLines: { line: number; text: string }[];
}

/** RFC 9309 2.2.1: the product token is the leading run of letters, "_" and "-". */
export function productToken(value: string): string {
  if (value.trim() === "*") return "*";
  return (value.trim().match(/^[A-Za-z_-]+/)?.[0] ?? "").toLowerCase();
}

function parseSignal(raw: string, line: number): ContentSignal {
  const values: Record<string, string> = {};
  for (const part of raw.split(",")) {
    const [key, value] = part.split("=").map((s) => s.trim());
    if (key) values[key.toLowerCase()] = (value ?? "").toLowerCase();
  }
  return { line, raw, values };
}

export function parseRobots(text: string): ParsedRobots {
  const result: ParsedRobots = { groups: [], sitemaps: [], managedSections: [], orphanRules: [], invalidLines: [] };
  const lines = text.replace(/^\uFEFF/, "").split(/\r\n|\r|\n/);
  let current: RobotsGroup | null = null;
  let collectingAgents = false;
  let openSection: { name: string; start: number } | null = null;

  lines.forEach((rawLine, index) => {
    const line = index + 1;
    const begin = rawLine.match(/^\s*#\s*BEGIN\s+(.+?)\s*$/i);
    if (begin && !openSection) openSection = { name: begin[1]!, start: line };
    else if (openSection && /^\s*#\s*END\b/i.test(rawLine)) {
      result.managedSections.push({ ...openSection, end: line });
      openSection = null;
    }

    const content = rawLine.replace(/#.*$/, "").trim();
    if (content === "") return;
    const colon = content.indexOf(":");
    if (colon === -1) {
      result.invalidLines.push({ line, text: content });
      return;
    }
    const key = content.slice(0, colon).trim().toLowerCase();
    const value = content.slice(colon + 1).trim();

    if (key === "user-agent") {
      if (!current || !collectingAgents) {
        current = { agents: [], rules: [], contentSignals: [], other: [] };
        result.groups.push(current);
        collectingAgents = true;
      }
      current.agents.push({ token: productToken(value), raw: value, line });
      return;
    }
    if (key === "sitemap") {
      result.sitemaps.push({ url: value, line });
      return;
    }
    if (key === "allow" || key === "disallow") {
      const rule: RobotsRule = { directive: key, pattern: value, line };
      if (openSection) rule.managed = (openSection as { name: string }).name;
      if (current) {
        current.rules.push(rule);
        collectingAgents = false;
      } else {
        result.orphanRules.push(rule);
      }
      return;
    }
    if (!current) {
      result.invalidLines.push({ line, text: content });
      return;
    }
    collectingAgents = false;
    if (key === "content-signal") current.contentSignals.push(parseSignal(value, line));
    else current.other.push({ key, value, line });
  });

  if (openSection) {
    const section = openSection as { name: string; start: number };
    let last = lines.length;
    while (last > section.start && lines[last - 1]!.trim() === "") last--;
    result.managedSections.push({ ...section, end: last });
  }
  return result;
}
