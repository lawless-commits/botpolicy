<!-- DRAFT. Not for posting until the owner has read every claim and approves it.
     Fill the [SURVEY] blanks only from the Phase 6b data, and link the method. -->
# Your robots.txt says one thing. Your site may do another.

Most AI crawler checkers read robots.txt and stop. But robots.txt is one of several places a crawler gets let in or kept out. Response headers, robots meta tags, your CDN or firewall, and whether the page has any text without JavaScript all decide it too. In a HasData study reported by PPC Land, 234 of 592 sites that disallow GPTBot in robots.txt still served it a live page. [Check against the original report before posting.]

I built **botpolicy** to check all of them against what you meant. You write a small policy, such as "search crawlers in, training crawlers out", and botpolicy checks the live site, or a deploy preview, against it in CI. When something drifts, it names the cause: `OAI-SearchBot on / should be reachable but is blocked, decided by robots.txt line 2: Disallow: /`.

Three things it does differently:

1. **It checks both ways.** It doesn't treat "more access is better" as the goal. It checks the split you wrote down.
2. **It shows its evidence.** Every check cites the operator's documentation or a published study. Checks with neither, such as llms.txt, are reported but never count.
3. **It won't guess.** If something can't be fetched, it says "not measured" instead of passing or failing. Simulated probe results are labelled as simulated.

[SURVEY] We ran it over [N] [list] sites: [finding, with the method linked].

It's MIT licensed. There's a CLI, a GitHub Action and a read-only MCP server: https://github.com/lawless-commits/botpolicy
