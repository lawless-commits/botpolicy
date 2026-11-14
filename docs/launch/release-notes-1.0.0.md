<!-- DRAFT. Not published. The owner approves the release before it goes out. -->
# botpolicy 1.0.0

The first release: a CLI, a library, a read-only MCP server and a GitHub Action that check what each AI crawler can reach on a site against a written policy.

## What's in it

- **`botpolicy init <url>`** writes `botpolicy.json` from what the site does today. **`botpolicy test`** checks the site, or a deploy preview, against it and exits 0, 1, 2 or 3.
- **robots.txt**, following RFC 9309: a verdict per crawler and path with the deciding line, groups that drop `*` rules, search crawlers caught by training blocks, CDN-managed blocks and `Content-Signal`, sitemaps.
- **Page checks:** `X-Robots-Tag`, robots meta and snippet controls, status, redirects and canonical, text without JavaScript, JSON-LD.
- **`--probe`** (opt-in): requests each page as each crawler, one a second, and classifies the response. Every result is labelled simulated.
- **Evidence:** each check cites a source and a level (documented, measured, unproven). Unproven checks carry no weight.
- **Registry:** 20 crawlers from 9 operators, each with the operator's documentation link and a verified date.
- **Outputs:** terminal, Markdown and JSON with a published schema (`schema/report.json`, version 1). The policy schema is `schema/policy.json`.
- **`botpolicy mcp`:** `audit_site`, `check_policy`, `explain_verdict`, `list_bots`, `draft_robots_rules`, all read-only.
- **The GitHub Action** writes a job summary, annotates broken rules and has a `status` output.

## Limits worth knowing

- Probe results come from your machine, not the crawlers' IP addresses, so a CDN that verifies crawlers by IP may treat the real crawler differently.
- Anthropic and Microsoft publish no full user-agent strings for their crawlers, so those crawlers are not probed. Bingbot is listed as unverified.
- Pages are decoded as UTF-8. No headless rendering in this release.
