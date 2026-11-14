# Botpolicy: open-source AI crawler policy checker

A public CLI, library and MCP server that reports what each AI crawler can actually reach on a site and fails CI when that drifts from a written policy.
The full plan is docs/roadmap.md. Work through its phases in order and stop at each "Done when" gate.
Do not start the next phase until the gate passes and the owner has seen the result.

## Stack
TypeScript, Node 22 or newer, pnpm, Vitest, ESLint, GitHub Actions. Build with plain `tsc`.
Runtime dependencies: the MCP TypeScript SDK, zod, one HTML parser. CLI flags use `node:util`.

## Commands
- `pnpm dev`: compile in watch mode
- `pnpm build`: compile `src/` to `dist/`
- `pnpm lint`: ESLint
- `pnpm typecheck`: `tsc --noEmit`, tests included
- `pnpm test`: Vitest, one run
- `pnpm run pack`: build, then write `botpolicy-<version>.tgz` (plain `pnpm pack` skips the build)
- `pnpm schema`: regenerate `schema/report.json` from the zod schema (a test fails if it drifts)

## Layout
- `src/core/`: pure functions with no network or disk access (`robots/`, `page/`, `probe/`, `policy/`, `report/`, `types.ts`)
- `src/data/`: `bots.json` (crawler registry) and `evidence.json` (one entry per check)
- `src/net/fetcher.ts`: the only module that makes requests
- `src/runner.ts`: turns a command into requests and core calls
- `src/cli.ts`, `src/mcp.ts`: thin shells over the runner
- `action.yml`: the GitHub Action
- `schema/`: JSON Schemas for the policy file and the report
- `fixtures/`: robots.txt files, HTML pages and a local test server
- `docs/`: roadmap.md (the spec), decisions.md (choices the roadmap left open), checks.md (what each check means)

## Rules that never bend
- Nothing in `src/core/` touches the network or the filesystem. All requests go through `src/net/fetcher.ts`.
- The fetcher refuses private, loopback and link-local addresses, on the first request and on every redirect.
- Fetch limits: 10-second timeout, 2 MB body, 5 redirects, 40 requests a run unless the owner raises it.
- Audits are passive by default. Requests that use a crawler's user agent happen only with `--probe`, at one a second.
- A probe result is always labelled simulated.
- Something that could not be fetched is reported as not measured. Never turn a missing file into a verdict.
- Every check has an entry in `evidence.json` with a level and a source. Checks marked unproven carry no weight.
- Every crawler in `bots.json` has the operator's documentation link and a verified date, or is marked unverified.
- Tests never call the internet. Use fixtures and the local test server.
- The tool never writes to a site, and writes no file except the report and policy paths the user asked for.
- MCP tools are read-only.
- The JSON report has a schema version. A breaking change to it is a major release.
- No telemetry.
- npm publishes, releases, registry listings and public posts wait for the owner's approval.
- No secrets in the repo.

## How to work
- Plan first for anything touching the fetcher, a verdict, the policy schema or a release; wait for approval.
- Write the failing test first for the robots.txt engine, the policy evaluator, the probe classifier and the fetcher's address checks.
- Check the current documentation before using the MCP SDK or adding a crawler; do not rely on memory for either.
- Small commits, one pull request per roadmap item, CI green before merge.
- If the roadmap leaves a choice open, pick the simplest option and record it in docs/decisions.md.
  Do not ask the owner about anything the roadmap already answers.
