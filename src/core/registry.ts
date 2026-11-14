import bots from "../data/bots.json" with { type: "json" };
import type { BotRecord } from "./types.js";

/** The crawler registry. Read-only data bundled with the package. */
export const BOTS: readonly BotRecord[] = bots as BotRecord[];

export function findBot(token: string): BotRecord | undefined {
  const wanted = token.toLowerCase();
  return BOTS.find((bot) => bot.token.toLowerCase() === wanted);
}
