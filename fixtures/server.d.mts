export interface FixtureSite {
  port: number;
  url: string;
  requests: { path: string; userAgent: string }[];
  close(): Promise<void>;
}
export function startSite(dir: string): Promise<FixtureSite>;
