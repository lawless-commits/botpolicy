# Decisions

Choices the roadmap left open, and the results of the checks it asks for. Newest phase last.

## Phase 0 (Nov 14, 2026)

### Name check: `botpolicy` stays

| Name | npm | GitHub |
| --- | --- | --- |
| `botpolicy` | free (404) | Three 0-star repos named `BotPolicy`/`botpolicy` (two with no description, one described as "e") and an org `BotPolicy` holding a privacy-policy repo. None is a crawler tool. |
| `bot-policy` | free | No exact match. The near name is [palantir/policy-bot](https://github.com/palantir/policy-bot) (1,077 stars), a GitHub App for pull request approval rules. Different field, but people may confuse the two in search. |
| `botpolicies` | free | One 0-star repo of terms of service for scheduling bots. |
| `robotspec` | free | [iamnarace/robotspec](https://github.com/iamnarace/robotspec), the competitor in the roadmap. Not on npm or PyPI. |
| `crawlpolicy` (backup 1) | free | No match. `crawl-policy` is also free on npm. |
| `crawlcontract` (backup 2) | free | **Taken on GitHub:** [lame13/crawlcontract](https://github.com/lame13/crawlcontract), a Rust CI tool for technical SEO (0 stars). Drop this backup. |

Result: keep `botpolicy`. The npm name is not reserved yet; that needs the owner's npm account. This is a screen, not trademark clearance.

### Wedge check: go, with a narrower claim

The three wedge points: (1) the whole stack per crawler, (2) a written policy checked both ways, (3) evidence on every check. READMEs were read on Nov 14, 2026; nothing was installed or run.

| Tool | Stars | 1. Whole stack | 2. Policy, both ways | 3. Evidence per check |
| --- | --- | --- | --- | --- |
| [geo-optimizer-skill](https://github.com/Auriti-Labs/geo-optimizer-skill) | 1,325 | Mostly: robots.txt, CDN access, JS rendering, snippet controls | No: a score threshold and `geo drift` | Partly: says every check lists a source, but `llms.txt` is worth 6 points |
| [geo-aeo-tracker](https://github.com/danishashko/geo-aeo-tracker) | 328 | Partly: robots.txt and server-rendered text | No: `--min-score` | No |
| [ai-crawler-bots](https://github.com/TryGeoSuite/ai-crawler-bots) | 2 | Partly: robots.txt, managed blocks, `Content-Signal`, a user-agent probe, logs. No header or meta checks | Partly: `--assert-allowed` and `--assert-blocked` flags, on the robots.txt verdict only; no policy file, no paths | Partly: operator-sourced bot list |
| [plugd](https://github.com/mdayan8/plugd) | 0 | Mostly: robots.txt, CDN, content checks | No | Mostly: an evidence brief; `llms.txt` unscored. AGPL |
| [robotspec](https://github.com/iamnarace/robotspec) | 0 | No: robots.txt only (headers and meta are on its roadmap) | Yes, for robots.txt: `robotspec.toml` | Partly: sourced catalogue |
| [crawlcheck-core](https://github.com/emmanuelorta/crawlcheck-core) | 0 | No: robots.txt per agent, shadowing, log verification | No | No |
| [actablesite-check](https://github.com/unitedideas/actablesite-check) (new find) | 0 | Mostly: robots.txt, meta robots, `X-Robots-Tag`, canonical, and an `--edge` probe. Homepage only, eight tokens, three probe user agents, no no-JS text check | No: `fail-on-noindex`, `fail-on-blocked`, `fail-on-restricted` flags. It cannot require that a crawler is blocked | Partly: careful limits on what each result proves; no source per check |
| [crawlcontract](https://github.com/lame13/crawlcontract) (new find) | 0 | Not about AI crawlers: general indexability in CI | Yes, for SEO rules | n/a |

Also seen and set aside as robots.txt-only: JaydenYoonZK/ai-crawler-audit, RazvanGabrielNiculae/ai-crawler-audit-tools, seoprocheck/ai-crawler-audit, dmf6009/ai-crawler-policy, funnyhcat-dotcom/robots-ai-policy-doctor (all 0 stars). `awesome-ai-visibility` listed nothing closer.

**Verdict: go.** No tool found does all three.

What changed from the roadmap's reading:

- **Point 1 is no longer unique on its own.** actablesite-check (July 2026, MIT, with a read-only MCP server and a paid monitor at $9 a month) covers four of the five layers for the homepage. geo-optimizer-skill covers most layers inside a score.
- **Point 2 is the real gap.** Nobody has a policy file that says "search in, training out" per path and checks it across every layer. robotspec does it for robots.txt; ai-crawler-bots does it with flags for robots.txt.
- **Point 3 is partly taken.** plugd and geo-optimizer-skill both cite sources. A per-check evidence level that sets the weight to zero is still not offered elsewhere.

So the pitch should lead with the policy file checked across the whole stack, per path, in both directions. "We check more than robots.txt" is not enough by itself.

Limits of this check: GitHub repo search and the roadmap's list only; no npm or PyPI keyword search, no closed-source tools.

### Smaller choices

- **TypeScript 6.0, not 7.0.** `typescript-eslint` 8.72 supports TypeScript below 6.1. Move to 7 when the linter does.
- **CI runs Node 22 and 24.** 22 is the stated minimum; 24 is the other LTS line.
- **No runtime dependencies in Phase 0.** The MCP SDK, zod and the HTML parser arrive in the phases that use them.
- **Two tsconfig files.** `tsconfig.json` type-checks everything; `tsconfig.build.json` leaves tests out of `dist`.
- **`pnpm run pack` builds first, then packs.** The tarball is checked in CI with `npx --package <tarball> botpolicy --version`.
- **With no arguments the CLI prints its version** until Phase 1 adds commands. Unknown flags already exit 2.
- **Commits use the GitHub noreply address** so the owner's personal email is not in public history.
- **Empty layout folders are not created** until a phase puts a file in them.

## Before Phase 1 (Nov 14, 2026)

The owner approved all five recommendations in `docs/plan.md`.

1. **The fetcher is built in Phase 1**, with every safety rule, because the Phase 1 gate needs `botpolicy robots <url>`. Phase 2 adds the request budget and page fetches.
2. **The address check is a constructor argument of the fetcher.** Tests pass one that allows the local test server's exact host and port. No CLI flag, environment variable or MCP input can set it.
3. **A 5xx robots.txt is reported as not measured and exits 3.** The report adds that a crawler following RFC 9309 would treat the whole site as disallowed.
4. **Probe requests are counted before any is sent.** Over the budget, the run exits 2 and says how to narrow crawlers or paths. Requests are never dropped silently.
5. **Until 1.0 the Action builds the CLI from its own checkout.** At release it switches to a pinned `npx botpolicy@<version>`.

Also approved with the plan: no probe through MCP in v1.

## Phase 1, slice 1: crawler registry (Nov 14, 2026)

Approved by the owner.

- **20 records: 19 verified, 1 unverified.** Each verified record was read on the operator's own page on Nov 14, 2026. Bingbot is listed as unverified because Bing's help page renders only in a browser.
- **Bytespider is left out** until an operator page is found.
- **Two fields added to the roadmap's `BotRecord`.** `isCrawler` is false for Google-Extended and Applebot-Extended, which are robots.txt controls and send no requests; the probe must never use them. `obeysRobotsQuote` keeps the operator's sentence.
- **`obeysRobots` is "unstated" unless the operator says it for that crawler or for all its crawlers.** OpenAI, Perplexity (for PerplexityBot), Common Crawl and Meta (for Meta-ExternalAgent) only explain how to block, so they are "unstated".
- **Dual-purpose crawlers get one purpose and a note.** Applebot is `search` (Apple says its data may also train models). Amazonbot and Meta-ExternalAgent are `training` (both also serve their products).
- **User-agent strings are copied exactly as published**, including placeholders such as `Chrome/W.X.Y.Z` and Meta's relative link. Anthropic publishes no full strings, so its three records have none. The probe will decide in Phase 4 how to handle placeholders and missing strings; it will not invent strings.
- **Amzn-SearchBot inherits other search crawlers' rules when not named**, per Amazon. A plain RFC 9309 reading gives it the `*` group. The robots engine must account for this, or report the difference.
- **R4 (retired tokens) is unproven.** Anthropic's page does not mention `anthropic-ai` or `Claude-Web`. It stays in the catalogue with no weight until a source is found.
- **New preference signals are out of v1.** Anthropic says it honours an AI-training preference signal from Oct 30, 2026, and Google plans `__usage_ai-training` in early 2027. Revisit after launch.

## Phase 1, robots checks (Nov 14, 2026)

Approved by the owner.

- **R1 status handling.** 2xx is parsed. 4xx is **measured** as "no robots.txt": every crawler is allowed, because the server answered that there is no file. 401 and 403 add a warning that a CDN may be refusing us. A 5xx, an unfinished 1xx or 3xx, or an unreachable file is **not measured** and exits 3; for a 5xx the report adds that a crawler following RFC 9309 would treat the site as closed. A 200 that serves HTML gets a warning and is parsed as an empty file.
- **R3** names each group that replaces `*` and lists the `*` disallows it loses. It probes each lost rule at the literal part of its pattern, before the first `*`.
- **R5 fires only for site-wide `*` blocks** (`Disallow: /` or `/*`). Blocking an area such as `/admin/` for everyone is a normal choice, and the first version warned about it on every search crawler. The other case, a search crawler blocked by name while its training sibling is allowed, fires on any path. Each crawler pair gets one finding, listing its paths.
- **R6** names the crawlers a CDN-managed block *blocks* (its `Allow: /` decides many verdicts too, which is not news) and lists each `Content-Signal` line.
- **Amzn-SearchBot** keeps the plain RFC 9309 verdict plus a note on Amazon's different reading.
- **Text formatting lives in `src/core/report/`** as a pure function, as the layout says.

## Phase 2, page analyser (Nov 14, 2026)

- **HTML parser: parse5 8.0.1.** It follows the WHATWG parsing standard, so tags land where a browser puts them, and it has one dependency (`entities`). htmlparser2 has four, node-html-parser two, linkedom five. 8.1.x was under two weeks old, so the older release is pinned in the lockfile.
- **HTML is parsed with scripting off**, so `<noscript>` content counts as text a crawler without JavaScript can read.
- **X-Robots-Tag scoping.** A name before a colon scopes the directives that follow, until the next name, unless the name is a directive that takes a value (`max-snippet`, `max-image-preview`, `max-video-preview`, `unavailable_after`). Known limit: Node joins repeated headers with ", ", so `googlebot: noindex` followed by a second header `nofollow` reads as both scoped to googlebot. Revisit if a real site shows it.
- **Crawler-named meta tags** (`<meta name="googlebot">`) count only for crawler names in the registry.
- **max-snippet:** the tightest limit wins; -1 (no limit) only when every value is -1.
- **P4 default threshold: 500 characters**, the figure in the roadmap's example policy. A policy file can change it.
- **Pages are decoded as UTF-8.** Other charsets are a known limit for now.
- The analyser records what each page says. Deciding what that means for each crawler's verdict is the combiner's job, in the next slice.

## Phase 2, evidence (Nov 14, 2026)

Every source was read on Nov 14, 2026.

- **P4 is "measured"**, not "to confirm". Source: the Vercel and MERJ server-log study (Dec 2024), which found that none of the major AI crawlers render JavaScript. The data is from 2024, so the level should be rechecked after launch.
- **E1 rests on secondary coverage** (PPC Land) of a vendor study made from datacenter IPs. The launch post must quote the original, as the roadmap says.
- **Google honours only `googlebot` and `googlebot-news` as meta tag names.** Apple and Amazon document their own page controls. A meta tag naming any other crawler is recorded but must carry no weight in a verdict.
- **R4 and I1 are unproven** and carry no weight. `carriesWeight()` is the single place that decides this.
- A test scans the source for every `check: "X1"` and fails if one has no evidence entry.

## Phase 2, verdicts, reports and audit (Nov 14, 2026)

Recommended by Claude and accepted by the owner's standing instruction.

- **Verdict order:** robots.txt not measured, then robots.txt blocked, then page not measured (unreachable or non-2xx for our request), then page controls, then allowed. Control-only tokens take the robots verdict alone.
- **A blocked verdict stays blocked for crawlers whose operator says robots.txt may not apply**, with the operator's sentence in a note.
- **Page controls make a verdict "restricted" only where the operator documents honouring them.** That covers Googlebot (header, `robots`, `googlebot`; noindex, none, nosnippet, max-snippet) and Applebot (header, `robots`, `applebot`; noindex, none, nosnippet), from their operator pages. It also covers Amazonbot (`robots` meta; noindex, none), applied to Amazonbot only because the page lists it under Amazonbot. Kept in `bots.json` as `pageControls`. Everywhere else, the control appears as a note.
- **`max-snippet:0` restricts; a positive limit does not.**
- **Report schema version 1**, defined in zod 4.6.7 (no dependencies) and generated with `z.toJSONSchema` into `schema/report.json`. A test fails if the committed file drifts. Reports are checked with the zod schema itself rather than a separate JSON Schema validator, which would be another dependency.
- **The time and version are passed into the report builder**, so the core stays pure and tests are repeatable.
- **The audit plans its requests before sending:** robots.txt, each path, the first sitemap and `/llms.txt`. If that is over budget it exits 2 before any request. A sitemap that only hits the 2 MB cap counts as reachable.
- **The audit exits 3 if any verdict is not measured.**
- **The fixture server is plain JavaScript** in `fixtures/server.mjs`, with a type declaration, so it stays out of the package build. `{{origin}}` in fixture files becomes the server's own address.

## Phase 3, policy, test, init and the Action (Nov 14, 2026)

Recommended by Claude and accepted by the owner's standing instruction.

- **Policy shape:** the roadmap's draft, made strict: unknown keys, unknown crawlers, unknown purposes and paths without a leading `/` are rejected with readable messages (exit 2). `bots` is `"*"`, `"purpose:<p>"`, `"operator:<o>"` or a list of tokens.
- **The last matching rule wins**, so a file lists general rules first and exceptions after, as in `.gitignore`. A rule's `paths` default to the policy's `paths`, and any path a rule names is added to the audit.
- **`expect` takes four values:** `allowed`, `blocked`, `restricted`, or `reachable` (allowed or restricted). `allowed` is strict: a noindexed page does not count as allowed.
- **Not measured never passes.** Exit codes: 1 if anything is broken, even when something else was not measured; otherwise 3 if anything was not measured; otherwise 0.
- **`page` requirements** (`minTextWithoutJs`, `requireJsonLd`) apply to the policy's own paths. `minTextWithoutJs` also sets the P4 threshold for that run.
- **`init` writes one rule per purpose where the purpose is uniform**, and splits into token or path rules where it is not. It adds `minTextWithoutJs: 500` only when every page already meets it. It refuses to overwrite without `--force` and writes nothing if anything was not measured.
- **The report gains an optional `policy` section.** This is an addition, so it stays at schema version 1. `schema/policy.json` is generated beside `schema/report.json`, and both are test-guarded.
- **The Action is composite.** It builds from its own checkout (decision 5), passes inputs through environment variables (no injection), writes Markdown to the job summary, prints `::error` annotations for broken rules, exposes `status`, and exits with the CLI's code. It runs `actions/setup-node` with Node 22, which also sets the Node version for later steps in the job; this is noted for the README.
- **Examples** are in `fixtures/policies/`: search in and training out, open and readable with page requirements, and path exceptions.

## Phase 4, the edge probe (Nov 14, 2026)

Recommended by Claude and accepted by the owner's standing instruction. The owner asked for Phase 4 work to go ahead while the Phase 3 demo waits on the Netlify setup.

- **Who is probed:** every crawler with `isCrawler` and a published user agent. Control tokens are never sent. Anthropic's three crawlers and Bingbot have no published string, so they are reported as "not probed" rather than given an invented one.
- **Placeholders:** `W.X.Y.Z` in an operator's string becomes `131.0.0.0`, the Chrome version in OpenAI's own example. This is the only change made to a published string.
- **Classes:** checked in this order against the baseline (our own user agent, same path). Not measured: either request failed, or the baseline was not 2xx. Challenged: a `cf-mitigated: challenge` header or a known challenge or CAPTCHA page, at any status. Denied: a non-2xx status where the baseline got 2xx. Different: redirected elsewhere, a different `<title>`, or under half the baseline's readable text. Served: anything else.
- **In the verdict:** denied or challenged makes a crawler "blocked", decided by "edge", unless robots.txt already blocked it. Different and not-measured probes add a note and leave the verdict alone. A robots.txt block that the edge does not enforce stays "blocked", with a note and an E1 information finding.
- **Simulated everywhere:** each edge result has `simulated: true`, the report has a `probe` section with the IP-verification caveat, and the text and Markdown say "(simulated)" on every edge verdict.
- **Manners:** one probe request a second. Requests are counted before any is sent, and an over-budget plan exits 2 with "Probe fewer crawlers with --bots, or check fewer paths". `--bots` applies only with `--probe`. A default probe of one path is 18 requests at most.
- **Schema:** `decidedBy` gains `"edge"`, and verdicts gain `edge`. The report gains `probe`. Pre-1.0, so it stays at version 1.
- **The Action** gains `probe` and `bots` inputs, off by default.

## Phase 5, the MCP server (Nov 14, 2026)

The SDK docs were read on Nov 14, 2026 (README, the v2 migration guide, the tools, stdio and testing pages), and the code was checked against the installed type definitions.

- **SDK: `@modelcontextprotocol/server` 2.4.0** (Oct 23, 2026). It depends only on `zod` and `@modelcontextprotocol/core`; the v1 `sdk` package has 17 dependencies. `@modelcontextprotocol/client` 2.4.0 is a dev dependency for tests.
- **`serveStdio(factory)`** rather than `server.connect(new StdioServerTransport())`. The current docs recommend it because it serves both the 2025 and the 2026 protocol versions; the README still shows the older form.
- **Five tools, all `readOnlyHint: true, destructiveHint: false`.** `audit_site` and `check_policy` return the report with `outputSchema: ReportSchema` and `structuredContent`; a test checks they equal the CLI's `--json` output. `explain_verdict` returns the verdict, the operator record, the relevant findings and a one-line explanation. `list_bots` returns the registry. `draft_robots_rules` returns text only.
- **`check_policy` takes the policy inline**, not as a file path, so the server never reads local files on a model's request.
- **No probe through MCP**, as approved. Extra arguments such as `probe: true` are ignored, and a test confirms only the tool's own user agent is sent.
- **A fresh fetcher for each tool call**, so each call gets its own 40-request budget and the address checks. A test confirms a private address is refused through MCP.
- **Path checks use `regex(/^\//)` rather than `startsWith`**, because zod writes `startsWith` as the non-standard JSON Schema format `starts_with`. The Inspector run showed it.
- **`version()` and `userAgent()` moved to `src/version.ts`**, so the CLI and the MCP server don't import each other.

## Phase 6 preparation (Nov 14, 2026)

Prepared while the Phase 3 to 5 gates wait on the owner. Nothing has been published.

- **`server.json`** follows the registry's 2025-12-11 schema: `io.github.lawless-commits/botpolicy`, npm, stdio, with `mcp` as a positional package argument. **`mcpName`** in package.json matches it. Both stay at version 0.0.0 until release.
- **The release workflow runs only on a `v*` tag push**, which only the owner does. It checks that the tag, package.json and server.json agree, runs all checks, publishes to npm with trusted publishing and provenance, then publishes to the MCP Registry via GitHub OIDC with `mcp-publisher` v1.8.7 (Oct 30, 2026; the asset name was checked on the release). It runs in a `release` environment, so the owner can require a manual approval.
- **README:** leads with the policy file checked across the whole stack, as the wedge check recommended. The sample output is real output from the demo site with a broken robots.txt. It says plainly that the package is not on npm yet.
- **`docs/checks.md`** is written from `evidence.json`, and a test checks that every check has a section with its level and source.
- **Drafts in `docs/launch/`:** release notes and a launch post. The post leaves blanks for the survey and flags the HasData figure, which must be checked against the original report before posting.
- **`exports`** points the library entry at `dist/runner.js`.
