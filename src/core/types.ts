/** What a crawler is for, as its operator describes it. */
export type BotPurpose = "training" | "search" | "user-fetch" | "other";

/** Whether the operator says the crawler follows robots.txt. */
export type RobotsStance = "yes" | "no" | "unstated";

export interface BotRecord {
  /** The robots.txt token, e.g. "GPTBot". */
  token: string;
  operator: string;
  purpose: BotPurpose;
  /** Example user-agent string as the operator gives it; null when none is published. */
  userAgent: string | null;
  obeysRobots: RobotsStance;
  /** The operator's own sentence about robots.txt, or null if there is none. */
  obeysRobotsQuote: string | null;
  /** False for tokens that only control use in robots.txt and never send requests. */
  isCrawler: boolean;
  /** The operator's documentation page. */
  docsUrl: string | null;
  /** ISO date the record was checked against docsUrl; null means unverified. */
  verified: string | null;
  /** Anything a reader needs to interpret the purpose, such as a second use. */
  note?: string;
}
