# Checks

Every check botpolicy runs, what it means and the evidence behind it. The levels:

- **documented**: the crawler's operator, or the standard, describes the behaviour.
- **measured**: an independent study with a published method found it.
- **unproven**: neither. The check is reported but never affects a verdict or a policy result.

The source data is [`src/data/evidence.json`](../src/data/evidence.json), and a test fails the build if a check has no entry.

## R1: robots.txt fetch status

How the robots.txt fetch ended. 2xx is parsed. 4xx means there is no file, so every crawler may fetch everything (a 401 or 403 adds a warning that something may be refusing us). 5xx, a timeout or a network failure is **not measured** and exits 3; under RFC 9309 a compliant crawler treats the site as closed while it lasts. A 200 that serves HTML gets a warning.

**Evidence: documented.** 4xx means a crawler may access any resource; 5xx means it must assume complete disallow. Source: [RFC 9309, section 2.3.1](https://www.rfc-editor.org/rfc/rfc9309.html#section-2.3.1), checked 2026-11-14.

## R2: Verdict per crawler and path, with the deciding line

The verdict for each crawler and path, and the line that decided it. The groups that name the crawler are merged, falling back to `*`. The longest pattern wins and allow wins a tie; `*` and `$` are supported and paths are percent-normalised.

**Evidence: documented.** The most specific match, by octets, wins; an equivalent allow should win. Source: [RFC 9309, section 2.2.2](https://www.rfc-editor.org/rfc/rfc9309.html#section-2.2.2), checked 2026-11-14.

## R3: A crawler's own group drops the * rules

A group that names a crawler replaces the `*` group for it, so every `*` disallow stops applying. Lists the rules each named group loses.

**Evidence: documented.** A crawler obeys the group matching its token and uses * only if none matches. Source: [RFC 9309, section 2.2.1](https://www.rfc-editor.org/rfc/rfc9309.html#section-2.2.1), checked 2026-11-14.

## R4: Rules aimed at retired tokens

Rules for `anthropic-ai` and `Claude-Web`. Anthropic's crawler page does not list them, so this is information only.

**Evidence: unproven.** The page does not mention anthropic-ai or Claude-Web, so nothing documents them as retired. Carries no weight. Source: [Anthropic crawler help page](https://support.claude.com/en/articles/8896518), checked 2026-11-14.

## R5: Search and training siblings handled differently

An operator's search or user crawler shut out by a site-wide `*` block while only its training sibling is named, or a search crawler blocked by name while its training sibling is allowed. Both usually mean the wrong crawler was named.

**Evidence: documented.** Operators document separate tokens for training, search and user fetches, each controlled on its own. Source: [OpenAI crawler documentation (and the other operators' pages in bots.json)](https://developers.openai.com/api/docs/bots), checked 2026-11-14.

## R6: CDN-managed blocks and Content-Signal lines

Rules inside a CDN-managed block (such as `# BEGIN Cloudflare Managed content`) that block a crawler, and each `Content-Signal` line.

**Evidence: documented.** Cloudflare prepends managed directives and a Content-Signal policy to the site's robots.txt. Source: [Cloudflare managed robots.txt documentation (updated 2026-11-02)](https://developers.cloudflare.com/bots/additional-configurations/managed-robots-txt/), checked 2026-11-14.

## R7: Sitemap declared and reachable

Whether robots.txt declares a sitemap, and whether the first one answers.

**Evidence: documented.** Crawlers may interpret records outside the protocol, such as Sitemap. Source: [RFC 9309, section 2.2.4](https://www.rfc-editor.org/rfc/rfc9309.html#section-2.2.4), checked 2026-11-14.

## P1: X-Robots-Tag header

`X-Robots-Tag` values, including crawler-scoped ones such as `googlebot: nosnippet`.

**Evidence: documented.** Google honours X-Robots-Tag, including crawler-scoped values. Apple and Amazon document page controls too (see bots.json). Source: [Google Search Central: robots meta tag and X-Robots-Tag](https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag), checked 2026-11-14.

## P2: Robots meta tags and snippet controls

`<meta name="robots">` and crawler-named meta tags, `nosnippet`, `max-snippet` and `data-nosnippet`. They make a verdict **restricted** only for crawlers whose operator documents honouring them: Googlebot, Applebot and Amazonbot. For other crawlers they appear as a note.

**Evidence: documented.** Google honours noindex, nosnippet, max-snippet and data-nosnippet. In meta names it honours only googlebot and googlebot-news. Source: [Google Search Central: robots meta tag and X-Robots-Tag](https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag), checked 2026-11-14.

## P3: Status, redirects and canonical

Non-2xx status, redirects, and a canonical URL (from HTML or the `Link` header) that points elsewhere. A page that answers our request with an error is not measured for every crawler.

**Evidence: documented.** rel=canonical in HTML or the Link header is a strong signal of the preferred URL. Source: [Google Search Central: canonical URLs](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls), checked 2026-11-14.

## P4: Readable text without JavaScript

Readable text in the raw HTML, with scripts and styles left out and `<noscript>` included. The default threshold is 500 characters.

**Evidence: measured.** Server-log study: none of the major AI crawlers measured, including GPTBot and ClaudeBot, rendered JavaScript. Data from 2024. Source: [Vercel and MERJ, The rise of the AI crawler (2024-12-17)](https://vercel.com/blog/the-rise-of-the-ai-crawler), checked 2026-11-14.

## P5: JSON-LD parses and declares a type

Each JSON-LD block parses and declares a `@type`, including inside `@graph`.

**Evidence: documented.** Google recommends JSON-LD for structured data. No AI crawler operator documents using it. Source: [Google Search Central: structured data](https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data), checked 2026-11-14.

## E1: Response to each crawler's user agent against the baseline

With `--probe` only: each crawler's response compared with the baseline. Served, denied (a non-2xx status), challenged (a bot challenge or CAPTCHA), different (a redirect, another title or under half the text) or not measured. **Always simulated:** the request comes from your machine, not the crawler's IP addresses.

**Evidence: measured.** 234 of 592 sites that disallow GPTBot still served it a page; 178 blocked it at the firewall while robots.txt said nothing. Secondary coverage of a vendor study using datacenter IPs. Source: [PPC Land on the HasData study (2026-10-08)](https://ppc.land/cloudflare-drops-ai-opt-outs-from-118-sites-robots-txt-hasdata-finds/), checked 2026-11-14.

## I1: llms.txt present

Whether `/llms.txt` exists. Reported, never weighed.

**Evidence: unproven.** 97% of llms.txt files received no requests in May 2026. Reported for information; carries no weight. Source: [Let's Data Science on an Ahrefs study (2026-06-16)](https://letsdatascience.com/news/ahrefs-finds-97-of-llmstxt-files-receive-no-requests-fc471b83), checked 2026-11-14.
