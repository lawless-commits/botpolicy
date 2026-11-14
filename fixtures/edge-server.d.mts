export interface EdgeSite {
  port: number;
  url: string;
  requests: { path: string; userAgent: string; at: number }[];
  close(): Promise<void>;
}
export function startEdgeSite(): Promise<EdgeSite>;
