/**
 * Classifies a response to a crawler's user agent against the baseline response
 * to the tool's own user agent. Pure. Every result is labelled simulated: the
 * request came from us, not from the crawler's own IP addresses.
 */
import { analysePage } from "../page/analyse.js";

export type ProbeResponse =
  | { ok: true; status: number; headers: Record<string, string>; body: string; finalUrl: string }
  | { ok: false; error: string; message: string };

export type ProbeClass = "served" | "denied" | "challenged" | "different" | "not-measured";

export interface ProbeResult {
  class: ProbeClass;
  status: number | null;
  reason: string;
  simulated: true;
}

/** Signs of a bot challenge or CAPTCHA, from common CDNs and bot managers. */
const CHALLENGE_BODY = [
  /\/cdn-cgi\/challenge-platform\//i,
  /<title>\s*just a moment\.\.\.\s*<\/title>/i,
  /<title>\s*attention required!/i,
  /\bpx-captcha\b/i,
  /_Incapsula_Resource/i,
  /\bg-recaptcha\b/i,
  /\bh-captcha\b/i,
  /\bcf-turnstile\b/i,
];

/** A crawler getting less than this share of the baseline's text counts as different. */
const MIN_TEXT_SHARE = 0.5;

function title(body: string): string {
  return (body.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? "").replace(/\s+/g, " ").trim();
}

function textLength(res: Extract<ProbeResponse, { ok: true }>): number {
  return analysePage({ kind: "response", url: res.finalUrl, finalUrl: res.finalUrl, status: res.status, headers: res.headers, body: res.body, redirects: [] }).textLength;
}

const result = (cls: ProbeClass, status: number | null, reason: string): ProbeResult => ({ class: cls, status, reason, simulated: true });

export function classify(baseline: ProbeResponse, crawler: ProbeResponse): ProbeResult {
  if (!baseline.ok) return result("not-measured", null, `the baseline request failed (${baseline.error}), so there is nothing to compare with`);
  if (!crawler.ok) return result("not-measured", null, `the request failed (${crawler.error})`);
  if (baseline.status < 200 || baseline.status >= 300) {
    return result("not-measured", crawler.status, `the baseline request got ${baseline.status}, so there is nothing to compare with`);
  }

  const challengeHeader = (crawler.headers["cf-mitigated"] ?? "").toLowerCase() === "challenge";
  if (challengeHeader || CHALLENGE_BODY.some((re) => re.test(crawler.body))) {
    return result("challenged", crawler.status, `got a bot challenge (HTTP ${crawler.status}${challengeHeader ? ", cf-mitigated: challenge" : ""})`);
  }
  if (crawler.status < 200 || crawler.status >= 300) {
    return result("denied", crawler.status, `got HTTP ${crawler.status} where the baseline got ${baseline.status}`);
  }
  if (new URL(crawler.finalUrl).href !== new URL(baseline.finalUrl).href) {
    return result("different", crawler.status, `was sent to ${crawler.finalUrl} instead of ${baseline.finalUrl}`);
  }
  const [bt, ct] = [title(baseline.body), title(crawler.body)];
  if (bt !== ct) return result("different", crawler.status, `got the title "${ct}" instead of "${bt}"`);
  const [bl, cl] = [textLength(baseline), textLength(crawler)];
  if (bl > 0 && cl < bl * MIN_TEXT_SHARE) {
    return result("different", crawler.status, `got ${cl} characters of text where the baseline got ${bl}`);
  }
  return result("served", crawler.status, `got the same page as the baseline (HTTP ${crawler.status})`);
}
