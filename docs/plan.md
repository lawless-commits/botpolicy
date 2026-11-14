# Build plan: Phases 1 to 6b

Written Nov 14, 2026, after the Phase 0 gate passed. `docs/roadmap.md` says what to build; this says in what order, in which pull requests, and what has to be decided first. Each numbered slice is one pull request. Each phase still stops at its gate.

## Five problems in the roadmap to settle first

These need your answer before the phase they affect. My recommendation is first in each.

1. **Phase 1 needs the fetcher, which the roadmap puts in Phase 2.** The Phase 1 gate requires `botpolicy robots <url>`, and every request must go through `src/net/fetcher.ts` with its address checks. Recommendation: build the fetcher, with all its safety rules, in Phase 1. Phase 2 then only adds the request budget and page fetches.
2. **The fetcher refuses loopback, but the tests use a local server.** Recommendation: the fetcher takes its address check as a constructor argument. Tests pass one that allows the test server's exact host and port. No flag, environment variable or MCP input can set it.
3. **RFC 9309 and the "not measured" rule disagree on a 5xx robots.txt.** The RFC says a crawler should assume everything is disallowed. Recommendation: report not measured and exit 3, as the roadmap gate says, with a note in the report that a compliant crawler would treat the site as closed.
4. **A probe of 15 crawlers over 3 paths is 45 requests, over the 40 limit.** Recommendation: the runner counts the requests before sending any. If the count is over budget it exits 2 and says how to narrow the crawlers or paths. It never drops requests silently.
5. **The Action is built in Phase 3, but the package reaches npm in Phase 6.** Recommendation: until 1.0 the Action builds the CLI from its own checkout. At release it switches to a pinned `npx botpolicy@<version>`.

## What I need from you, and when

| When | What |
| --- | --- |
| Before Phase 1 | Answers to problems 1 to 3 |
| Start of Phase 1 | Approval of the crawler list and the `BotRecord` shape |
| Start of Phase 3 | Approval of the policy file shape, from three examples; a go-ahead to create a public demo repo |
| Before Phase 4 | Answer to problem 4; the site you control for the probe check, and access to its CDN or host dashboard |
| Before Phase 6 | npm account with two-factor sign-in; `botpolicy` reserved |
| Before Phase 6b | The survey's site list |
| Phase 6 | Approval of every publish, release, listing and post |

## Phase 1: crawler registry and robots.txt engine

1. **Types and registry.** `src/core/types.ts` and `src/data/bots.json`. I check each operator's own documentation before adding a crawler and show you the list first. Candidates: GPTBot, OAI-SearchBot, ChatGPT-User, OAI-AdsBot, ClaudeBot, Claude-SearchBot, Claude-User, PerplexityBot, Perplexity-User, Google-Extended, Googlebot, Bingbot, Applebot, Applebot-Extended, CCBot, Meta-ExternalAgent, Amazonbot, Bytespider. A test fails if a record lacks a documentation link and verified date and is not marked unverified. `botpolicy bots` prints it.
2. **Fetcher** (failing tests first). Uses `node:http` and `node:https` with a lookup that checks the resolved address and connects to that same address. Refuses private, loopback, link-local and IPv4-mapped IPv6 addresses on the first request and each redirect. 10-second timeout, 2 MB cap after decompression, 5 redirects. I will show you the design before writing it.
3. **Parser** (failing tests from RFC 9309 first). Groups, merged groups for one token, case, BOM, CRLF, comments, unknown lines, `Sitemap`, `Content-Signal`, and a line number on every rule.
4. **Matcher and explainer.** Longest match, allow on a tie, `*` and `$`, percent-encoding. Every verdict names its deciding line, or says no rule matched.
5. **Robots checks R1 to R6.** Status handling, groups that shadow `*`, retired tokens, search and training siblings treated differently, content signals and CDN-managed blocks. R7 waits for Phase 2 because it needs a second fetch.
6. **`botpolicy robots <url or file>`.** Offline on a file. An unreachable robots.txt prints not measured and exits 3.

Gate: RFC examples and fixtures pass; the command prints a verdict and deciding line per crawler; unreachable exits 3.

## Phase 2: page layer and the audit command

1. **Request budget and runner.** 40 requests a run, counted in the fetcher. `src/runner.ts` plans the requests for a command.
2. **Page analyser.** P1 to P5 as pure functions over headers and HTML. I pick the HTML parser by size and maintenance and record the choice.
3. **`evidence.json`.** One entry per check with level, source and date. A test fails if a check has none. I look for a source for P4; if there is none it is marked unproven and carries no weight.
4. **Verdict combiner.** One verdict per crawler and path from the robots and page layers, keeping each layer's reason. This changes verdicts, so I show the rules first.
5. **Reports.** Terminal, Markdown and JSON. The JSON shape is defined once in zod, and `schema/report.json` is generated from it at schema version 1.
6. **`botpolicy audit`, R7, I1 and five fixture sites** served by the local test server: clean, blocked in robots.txt, `noindex` header, empty JavaScript shell, CDN-managed robots.txt.

Gate: expected findings on all five; the JSON validates; the fetcher refuses a private address.

## Phase 3: policy file, test command and Action

1. **Policy schema.** I show three example files and the rule order before writing code. Open points I will propose answers to: which rule wins when two match, whether `restricted` satisfies `allowed`, and that a not-measured result exits 3 and never passes. `schema/policy.json` is generated from zod.
2. **Evaluator** (failing tests first). Pure: verdicts and a policy in, pass or fail per rule out, with the deciding line.
3. **`botpolicy test`** with exit codes 0, 1, 2 and 3.
4. **`botpolicy init <url>`.** Writes `botpolicy.json` from current behaviour, only to the path asked for, and refuses to overwrite without a flag.
5. **`action.yml`** with a job summary, per problem 5.
6. **Demo repo.** A small public site on GitHub Pages with the Action, one pull request that breaks the policy and one that fixes it.

Gate: the breaking pull request fails CI and names the deciding line; the fix passes.

## Phase 4: edge probe

1. **Local test server** that refuses, challenges and alters responses by user agent.
2. **Classifier** (failing tests first). Pure: baseline and crawler response in; served, denied, challenged or different out. I show how each class is detected before writing it.
3. **`--probe` in the runner.** One request a second, the up-front budget count from problem 4, and the simulated label on every result in all three report formats.
4. **Edge layer in the verdict and the policy.** A policy rule is checked against the probe only when the run used `--probe`.
5. **Real check** against your site, compared by you with the dashboard.

Gate: classifier right on the local server; the real probe matches the dashboard; a test proves a run cannot exceed the budget.

## Phase 5: MCP server

1. **Read the current SDK documentation** and record the version and API used.
2. **`src/mcp.ts`.** A stdio server with `audit_site`, `check_policy`, `explain_verdict`, `list_bots` and `draft_robots_rules`, each a thin call into the runner. Recommendation: no probe through MCP in v1, so an assistant cannot be talked into impersonating crawlers.
3. **Tests.** Tool output equals the CLI's JSON for the same input; a private address is refused through MCP as well.
4. **Manual checks.** MCP Inspector, then `claude mcp add`.

Gate: the Inspector lists the tools; Claude Code runs an audit; outputs match.

## Phase 6b: the survey (before the launch post)

1. **Plan for your approval:** the list and its source, requests per site, what is recorded, what is published.
2. **A script in the repo** that reruns from the list to the table, with raw results saved as data files.
3. **The run,** with `--probe`, a small budget per site, and a user agent that links to the method.
4. **The write-up,** from the data only. You read every claim.

Gate: anyone can rerun it and get the same table.

## Phase 6: launch

1. **README and `docs/checks.md`.** The README leads with the policy file checked across the whole stack, which is what the wedge check found is still open.
2. **Release workflow** using npm trusted publishing, and the Action switched to the published package.
3. **MCP Registry entry** prepared.
4. **Release notes and launch posts** drafted.
5. **Stop.** You approve the publish, the 1.0.0 release, the listing and each post, one at a time.

Gate: `npx botpolicy audit <url>` works on a clean machine; the registry lists the server; you have posted the launch.

## Rules for every slice

- One branch and pull request per slice, CI green before merge.
- A design note for your approval before any slice that touches the fetcher, a verdict, the policy schema or a release.
- New choices go in `docs/decisions.md`.
- A fresh Claude Code session per phase.
