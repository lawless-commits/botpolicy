import type { BotRecord } from "../types.js";

/** The Chrome version put in place of an operator's "W.X.Y.Z" placeholder; OpenAI's own example uses it. */
export const PLACEHOLDER_CHROME = "131.0.0.0";

/**
 * The user agent the probe sends for a crawler, or null if it must not be probed:
 * control-only tokens send no requests, and crawlers with no published string are
 * not given an invented one.
 */
export function probeUserAgent(bot: BotRecord): string | null {
  if (!bot.isCrawler || bot.userAgent === null) return null;
  return bot.userAgent.replace(/\*?W\.X\.Y\.Z\*?/g, PLACEHOLDER_CHROME);
}
