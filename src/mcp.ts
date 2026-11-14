/**
 * The MCP server: five read-only tools over the same runner as the CLI.
 * No tool writes a file or probes: requests use the tool's own user agent only,
 * and every request goes through the fetcher's address checks.
 */
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";
import { describeVerdict } from "./core/policy/evaluate.js";
import { BotSelectorSchema, parsePolicy, PolicyError, policyPaths } from "./core/policy/schema.js";
import { BOTS, findBot } from "./core/registry.js";
import { ReportSchema, type Report } from "./core/report/schema.js";
import { draftRobotsRules } from "./core/robots/draft.js";
import { evaluatePolicy } from "./core/policy/evaluate.js";
import { createFetcher, type Fetcher } from "./net/fetcher.js";
import { InputError, runAudit } from "./runner.js";
import { userAgent, version } from "./version.js";

export interface McpDeps {
  /** A fresh fetcher, with its own budget, for each tool call. */
  makeFetcher: () => Fetcher;
  now?: () => Date;
}

const READ_ONLY_WEB = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;
const READ_ONLY_LOCAL = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

const json = (value: unknown) => JSON.stringify(value, null, 2) + "\n";
const failure = (message: string) => ({ content: [{ type: "text" as const, text: message }], isError: true });
const reportResult = (report: Report) => ({
  content: [{ type: "text" as const, text: json(report) }],
  structuredContent: report as unknown as Record<string, unknown>,
});

async function guarded<T>(work: () => Promise<T>): Promise<T | ReturnType<typeof failure>> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof InputError || error instanceof PolicyError) return failure(error.message);
    throw error;
  }
}

const Paths = z.array(z.string().regex(/^\//)).min(1).max(10).optional()
  .describe('Paths to check, each starting with "/". Default ["/"].');

export function createMcpServer(deps: Partial<McpDeps> = {}): McpServer {
  const makeFetcher = deps.makeFetcher ?? (() => createFetcher({ userAgent: userAgent() }));
  const options = () => ({ version: version(), now: deps.now });
  const server = new McpServer({ name: "botpolicy", version: version() });

  server.registerTool(
    "audit_site",
    {
      title: "Audit a site",
      description:
        "Report what each AI crawler can reach on a site: robots.txt verdicts with the deciding line, page-level controls, and findings with their evidence. Passive: requests use botpolicy's own user agent. Same JSON as `botpolicy audit --json`.",
      inputSchema: z.object({ url: z.url().describe("The site, e.g. https://example.com"), paths: Paths }),
      outputSchema: ReportSchema,
      annotations: READ_ONLY_WEB,
    },
    async ({ url, paths }) => guarded(async () => reportResult(await runAudit(url, paths ?? ["/"], { fetcher: makeFetcher() }, options()))),
  );

  server.registerTool(
    "check_policy",
    {
      title: "Check a site against a policy",
      description:
        "Check a site against a botpolicy.json policy given inline, and report which expectations hold or break, naming what decided each. Same JSON as `botpolicy test --json`. The policy's `site` is used unless `url` is given (for example a deploy preview).",
      inputSchema: z.object({
        policy: z.record(z.string(), z.unknown()).describe("The policy file's contents, as JSON"),
        url: z.url().optional().describe("URL to check instead of the policy's site"),
      }),
      outputSchema: ReportSchema,
      annotations: READ_ONLY_WEB,
    },
    async ({ policy: raw, url }) =>
      guarded(async () => {
        const policy = parsePolicy(raw);
        const report = await runAudit(url ?? policy.site, policyPaths(policy), { fetcher: makeFetcher() }, {
          ...options(),
          minText: policy.page?.minTextWithoutJs,
        });
        report.policy = { file: "(inline)", ...evaluatePolicy(policy, report, BOTS) };
        return reportResult(report);
      }),
  );

  server.registerTool(
    "explain_verdict",
    {
      title: "Explain one crawler's verdict",
      description: "Explain why one crawler is allowed, blocked or restricted on one path of a site, with the deciding line and any notes.",
      inputSchema: z.object({
        url: z.url().describe("The site"),
        bot: z.string().describe("Crawler token, e.g. GPTBot; see list_bots"),
        path: z.string().regex(/^\//).optional().describe('Default "/"'),
      }),
      annotations: READ_ONLY_WEB,
    },
    async ({ url, bot: token, path }) =>
      guarded(async () => {
        const bot = findBot(token);
        if (!bot) return failure(`unknown crawler '${token}'; call list_bots to see them`);
        const at = path ?? "/";
        const report = await runAudit(url, [at], { fetcher: makeFetcher() }, options());
        const verdict = report.verdicts.find((v) => v.token === bot.token && v.path === at)!;
        const findings = report.findings.filter((f) => f.bots.includes(bot.token) || f.bots.includes("*"));
        const explanation = [
          `${bot.token} (${bot.operator}, ${bot.purpose}) on ${at} is ${verdict.verdict}, decided by ${describeVerdict(verdict)}.`,
          ...verdict.notes,
        ].join(" ");
        return { content: [{ type: "text" as const, text: json({ explanation, verdict, bot, findings }) }] };
      }),
  );

  server.registerTool(
    "list_bots",
    {
      title: "List known AI crawlers",
      description: "The crawler registry: token, operator, purpose, whether the operator says it follows robots.txt, its documentation link and the date it was verified.",
      annotations: READ_ONLY_LOCAL,
    },
    async () => ({ content: [{ type: "text" as const, text: json(BOTS) }] }),
  );

  server.registerTool(
    "draft_robots_rules",
    {
      title: "Draft robots.txt rules",
      description:
        'Draft robots.txt groups that block and allow crawlers, e.g. block "purpose:training" and allow "purpose:search". Returns text only and never writes a file.',
      inputSchema: z.object({
        block: BotSelectorSchema.optional().describe('"*", "purpose:<p>", "operator:<o>" or a list of tokens'),
        allow: BotSelectorSchema.optional().describe("Same forms as block"),
      }),
      annotations: READ_ONLY_LOCAL,
    },
    async ({ block, allow }) => {
      if (!block && !allow) return failure("give block, allow or both");
      return { content: [{ type: "text" as const, text: draftRobotsRules(block, allow, BOTS) }] };
    },
  );

  return server;
}

/** botpolicy mcp: serve over stdio until stdin closes. Logs go to stderr; stdout is the protocol. */
export function startStdio(): void {
  const handle = serveStdio(() => createMcpServer(), { onerror: (error) => console.error(`botpolicy mcp: ${error.message}`) });
  const stop = () => void handle.close().then(() => process.exit(0));
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
