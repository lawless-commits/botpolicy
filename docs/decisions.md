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
