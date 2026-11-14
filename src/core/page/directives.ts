/** Robots directives from X-Robots-Tag headers and robots meta tags. Pure. */

/** Directive names that can carry a value after a colon; anything else before a colon is a crawler name. */
const VALUED = new Set(["max-snippet", "max-image-preview", "max-video-preview", "unavailable_after"]);

/** Splits "noindex, max-snippet: 50" into ["noindex", "max-snippet:50"]. */
export function parseDirectiveList(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part !== "")
    .map((part) => {
      const colon = part.indexOf(":");
      return colon === -1 ? part : `${part.slice(0, colon).trim()}:${part.slice(colon + 1).trim()}`;
    });
}

export interface ScopedDirectives {
  /** Lower-cased crawler name, or null for every crawler. */
  agent: string | null;
  directives: string[];
}

/**
 * Parses an X-Robots-Tag value. "googlebot: noindex, nosnippet" scopes the
 * directives that follow to googlebot, until the next crawler name.
 */
export function parseHeaderDirectives(value: string): ScopedDirectives[] {
  const out: ScopedDirectives[] = [];
  let current: ScopedDirectives | null = null;
  for (const raw of value.split(",")) {
    let part = raw.trim();
    if (part === "") continue;
    const colon = part.indexOf(":");
    if (colon !== -1) {
      const name = part.slice(0, colon).trim().toLowerCase();
      if (!VALUED.has(name)) {
        current = { agent: name, directives: [] };
        out.push(current);
        part = part.slice(colon + 1).trim();
        if (part === "") continue;
      }
    }
    if (!current) {
      current = { agent: null, directives: [] };
      out.push(current);
    }
    current.directives.push(...parseDirectiveList(part));
  }
  return out.filter((s) => s.directives.length > 0);
}

export interface DirectiveSummary {
  noindex: boolean;
  nofollow: boolean;
  nosnippet: boolean;
  noarchive: boolean;
  /** The smallest max-snippet seen, or null if none. -1 means no limit. */
  maxSnippet: number | null;
}

/** The tightest limit; -1 (no limit) only when every value says so; null when none is set. */
function limitedSnippets(values: number[]): number | null {
  if (values.length === 0) return null;
  const limits = values.filter((n) => n >= 0);
  return limits.length ? Math.min(...limits) : -1;
}

export function summarise(directives: string[]): DirectiveSummary {
  const has = (d: string) => directives.includes(d);
  const snippets = directives
    .filter((d) => d.startsWith("max-snippet:"))
    .map((d) => d.slice("max-snippet:".length))
    .filter((v) => /^-?\d+$/.test(v))
    .map(Number);
  return {
    noindex: has("noindex") || has("none"),
    nofollow: has("nofollow") || has("none"),
    nosnippet: has("nosnippet"),
    noarchive: has("noarchive"),
    maxSnippet: limitedSnippets(snippets),
  };
}
