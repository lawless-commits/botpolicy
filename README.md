# botpolicy

**Write down which AI crawlers may read your site. Fail CI when the live site stops matching.**

robots.txt is one of several places a crawler gets let in or kept out. Response headers, robots meta tags, the CDN or firewall, and whether the page has any text without JavaScript all decide it too. botpolicy checks every one of them, per crawler, against a policy file you keep in the repo:

```json
{
  "site": "https://example.com",
  "paths": ["/", "/blog/"],
  "rules": [
    { "bots": "purpose:search", "expect": "allowed" },
    { "bots": "purpose:user-fetch", "expect": "allowed" },
    { "bots": "purpose:training", "expect": "blocked" }
  ]
}
```

When a deploy breaks it, the check names what decided it:

```text
Policy botpolicy.json: FAIL (7 held, 12 broken, 0 not measured)
  BROKEN  OAI-SearchBot on / should be reachable but is blocked, decided by robots.txt line 2: Disallow: /.
  BROKEN  ChatGPT-User on / should be reachable but is blocked, decided by robots.txt line 2: Disallow: /.
  BROKEN  Claude-SearchBot on / should be reachable but is blocked, decided by robots.txt line 2: Disallow: /.
```

> **Not on npm yet.** The commands below work once 1.0.0 is published. Until then, clone the repo, run `pnpm install && pnpm build`, and use `node dist/cli.js` in place of `npx botpolicy`.

## Quickstart

1. **Write a policy from what your site does today:**
   ```sh
   npx botpolicy init https://example.com
   ```
   Review `botpolicy.json` and change any rule that does not match what you want.
2. **Check it:**
   ```sh
   npx botpolicy test
   ```
   The command exits `0` when the policy holds, `1` when it is broken, `2` for a bad policy file and `3` when something could not be measured.
3. **Run it in CI** on pull requests and every week, because a CDN setting can change without a commit:
   ```yaml
   on:
     pull_request:
     schedule:
       - cron: "0 6 * * 1"
   jobs:
     botpolicy:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4
         - uses: lawless-commits/botpolicy@main
           with:
             url: https://deploy-preview.example.com # optional; defaults to the policy's site
   ```
   The Action writes the report to the job summary and annotates each broken rule. [botpolicy-demo](https://github.com/lawless-commits/botpolicy-demo) shows it running on Netlify deploy previews.

## What it checks

| Layer | Checks |
| --- | --- |
| robots.txt | RFC 9309 verdict per crawler and path with the deciding line. Also: crawler groups that silently drop your `*` rules, search crawlers caught by a block meant for training, CDN-managed blocks and `Content-Signal` lines, the sitemap. |
| Page | `X-Robots-Tag` (including `googlebot:` scoping), robots meta tags, `nosnippet` and `max-snippet`, status, redirects and canonical, readable text without JavaScript, JSON-LD. |
| Edge (opt-in) | `--probe` requests each page again as each crawler, one a second, and reports served, denied, challenged or different. |

Every check cites a source and an evidence level in [docs/checks.md](docs/checks.md): **documented** by the crawler's operator, **measured** by a published study, or **unproven**. Unproven checks, such as whether you have an `llms.txt`, are reported but never count.

**Three rules the results follow:**

- **Not measured is not a verdict.** If robots.txt or a page cannot be fetched, the result says so and exits `3`. It never guesses.
- **Page controls count only where the operator documents them.** A `noindex` restricts Googlebot, Applebot and Amazonbot, whose operators say they honour it. For other crawlers, the report notes it instead.
- **Probe results are simulated.** The requests come from your machine with the crawler's published user agent, not from the crawler's IP addresses. Large CDNs check real crawlers by IP, so the report labels every probe result as simulated.

## Crawlers

`npx botpolicy bots` lists the registry: 20 crawlers from OpenAI, Anthropic, Perplexity, Google, Apple, Common Crawl, Meta, Amazon and Microsoft. Each one has its purpose (training, search, user-triggered fetch or other), whether the operator says it follows robots.txt, a link to the operator's own documentation and the date it was checked. A crawler without readable operator documentation is marked unverified.

## Policy file

- `bots` is `"*"`, `"purpose:training"` (or `search`, `user-fetch`, `other`), `"operator:OpenAI"` or a list such as `["GPTBot", "ClaudeBot"]`.
- `expect` is `allowed`, `blocked`, `restricted` (reachable but limited by a page control) or `reachable` (allowed or restricted).
- `paths` on a rule narrows it to those paths.
- **The last matching rule wins**, so list general rules first and exceptions after.
- `page` can require `minTextWithoutJs` characters and JSON-LD types with `requireJsonLd`.

The schema is [schema/policy.json](schema/policy.json). Examples are in [fixtures/policies](fixtures/policies).

**Netlify deploy previews** get `X-Robots-Tag: noindex` automatically, so on a preview Googlebot and Applebot show as `restricted`. Expect `reachable` for search crawlers when you test previews.

## Other commands

```sh
npx botpolicy audit https://example.com --path / --path /pricing   # the full report, no policy
npx botpolicy audit https://example.com --format markdown           # or json (schema/report.json)
npx botpolicy robots ./public/robots.txt                            # robots.txt only, offline
npx botpolicy audit https://example.com --probe --bots GPTBot,ClaudeBot  # add the edge layer
```

## MCP server

`botpolicy mcp` serves five read-only tools over stdio: `audit_site`, `check_policy`, `explain_verdict`, `list_bots` and `draft_robots_rules`. They return the same JSON as the CLI. They never write files and never probe.

```sh
claude mcp add botpolicy -- npx -y botpolicy mcp
```

## Manners and safety

- **Passive by default:** one request for robots.txt and one per page, plus the sitemap and `llms.txt`, sent with an honest user agent (`botpolicy/<version> (+https://github.com/lawless-commits/botpolicy)`).
- **Request limits:** 40 requests a run, a 10-second timeout, a 2 MB body cap and 5 redirects.
- **No private addresses:** private, loopback and link-local addresses are refused, on the first request and on every redirect, so the MCP server cannot be pointed at your internal network.
- **Nothing written:** botpolicy writes no file except the policy that `init` creates, and it has no telemetry.
- **Probing:** only probe sites you control.

## License

MIT
