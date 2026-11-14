/**
 * The only module that makes network requests. Every safety rule lives here:
 * address checks on the first request and every redirect, a deadline, a body
 * cap counted after decompression, a redirect limit and a request budget.
 */
import { promises as dns, type LookupAddress } from "node:dns";
import http, { type IncomingMessage } from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import type { Readable, Transform } from "node:stream";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import { isPublicAddress } from "./address.js";

export const DEFAULT_LIMITS = {
  timeoutMs: 10_000,
  maxBytes: 2 * 1024 * 1024,
  maxRedirects: 5,
  budget: 40,
} as const;

export type FetchErrorKind =
  | "bad-url"
  | "refused-address"
  | "dns"
  | "timeout"
  | "too-large"
  | "too-many-redirects"
  | "budget-exhausted"
  | "network";

export interface FetchOk {
  ok: true;
  url: string;
  status: number;
  headers: Record<string, string>;
  body: string;
  finalUrl: string;
  redirects: string[];
}

export interface FetchFailure {
  ok: false;
  url: string;
  error: FetchErrorKind;
  message: string;
  redirects: string[];
}

export type FetchResult = FetchOk | FetchFailure;

export interface FetcherOptions {
  userAgent: string;
  /**
   * Decides whether an address may be contacted. Defaults to public addresses only.
   * Tests replace it to reach the local test server; nothing a user controls may set it.
   */
  checkAddress?: (ip: string, port: number) => boolean;
  /** Resolves a hostname to every address. Defaults to the system resolver. */
  resolve?: (host: string) => Promise<LookupAddress[]>;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  budget?: number;
}

export interface Fetcher {
  fetch(url: string): Promise<FetchResult>;
  used(): number;
  readonly limits: { timeoutMs: number; maxBytes: number; maxRedirects: number; budget: number };
}

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

class FetchError extends Error {
  constructor(
    readonly kind: FetchErrorKind,
    message: string,
  ) {
    super(message);
  }
}

function decoder(encoding: string | undefined): Transform | null {
  switch (encoding?.trim().toLowerCase()) {
    case "gzip":
    case "x-gzip":
      return createGunzip();
    case "deflate":
      return createInflate();
    case "br":
      return createBrotliDecompress();
    default:
      return null;
  }
}

function flattenHeaders(res: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(res.headers)) {
    if (value !== undefined) out[name] = Array.isArray(value) ? value.join(", ") : value;
  }
  return out;
}

export function createFetcher(options: FetcherOptions): Fetcher {
  const limits = {
    timeoutMs: options.timeoutMs ?? DEFAULT_LIMITS.timeoutMs,
    maxBytes: options.maxBytes ?? DEFAULT_LIMITS.maxBytes,
    maxRedirects: options.maxRedirects ?? DEFAULT_LIMITS.maxRedirects,
    budget: options.budget ?? DEFAULT_LIMITS.budget,
  };
  const checkAddress = options.checkAddress ?? ((ip: string) => isPublicAddress(ip));
  const resolve = options.resolve ?? ((host: string) => dns.lookup(host, { all: true, verbatim: true }));
  let used = 0;

  /** Resolves and checks the target; returns the one address the socket must use. */
  async function pinAddress(url: URL, signal: AbortSignal): Promise<LookupAddress> {
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
    let addresses: LookupAddress[];
    if (isIP(host)) {
      addresses = [{ address: host, family: isIP(host) }];
    } else {
      try {
        addresses = await Promise.race([
          resolve(host),
          new Promise<never>((_, reject) => {
            if (signal.aborted) reject(new Error("aborted"));
            signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
          }),
        ]);
      } catch (error) {
        if (signal.aborted) throw new FetchError("timeout", `no complete response within ${limits.timeoutMs} ms`);
        throw new FetchError("dns", `could not resolve ${host}: ${String(error)}`);
      }
      if (addresses.length === 0) throw new FetchError("dns", `no addresses for ${host}`);
    }
    const refused = addresses.find((a) => !checkAddress(a.address, port));
    if (refused) {
      throw new FetchError("refused-address", `${host} resolves to ${refused.address}, which is not a public address`);
    }
    return addresses[0]!;
  }

  function requestOnce(url: URL, pinned: LookupAddress, signal: AbortSignal): Promise<{ res: IncomingMessage; body?: string }> {
    return new Promise((resolvePromise, reject) => {
      const transport = url.protocol === "https:" ? https : http;
      const req = transport.request(url, {
        method: "GET",
        agent: false,
        headers: {
          "user-agent": options.userAgent,
          accept: "*/*",
          "accept-encoding": "gzip, deflate, br",
        },
        // Connect only to the address that was checked; no second lookup.
        lookup: (_host, opts, callback) => {
          if ((opts as { all?: boolean }).all) {
            (callback as (e: null, a: LookupAddress[]) => void)(null, [pinned]);
          } else {
            (callback as (e: null, a: string, f: number) => void)(null, pinned.address, pinned.family);
          }
        },
      });

      let settled = false;
      const fail = (error: FetchError) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", onAbort);
        req.destroy();
        reject(error);
      };
      const onAbort = () => fail(new FetchError("timeout", `no complete response within ${limits.timeoutMs} ms`));
      if (signal.aborted) return onAbort();
      signal.addEventListener("abort", onAbort, { once: true });

      req.on("error", (error) => fail(new FetchError("network", error.message)));
      req.on("response", (res) => {
        if (REDIRECTS.has(res.statusCode ?? 0) && res.headers.location) {
          res.resume();
          settled = true;
          signal.removeEventListener("abort", onAbort);
          return resolvePromise({ res });
        }
        const decode = decoder(res.headers["content-encoding"]);
        const stream: Readable = decode ? res.pipe(decode) : res;
        const chunks: Buffer[] = [];
        let size = 0;
        stream.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > limits.maxBytes) {
            stream.destroy();
            res.destroy();
            return fail(new FetchError("too-large", `body is over ${limits.maxBytes} bytes`));
          }
          chunks.push(chunk);
        });
        stream.on("error", (error) => fail(new FetchError("network", error.message)));
        res.on("error", (error) => fail(new FetchError("network", error.message)));
        stream.on("end", () => {
          if (settled) return;
          settled = true;
          signal.removeEventListener("abort", onAbort);
          resolvePromise({ res, body: new TextDecoder("utf-8").decode(Buffer.concat(chunks)) });
        });
      });
      req.end();
    });
  }

  async function fetch(input: string): Promise<FetchResult> {
    const redirects: string[] = [];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), limits.timeoutMs);
    try {
      let url: URL;
      try {
        url = new URL(input);
      } catch {
        throw new FetchError("bad-url", `not a URL: ${input}`);
      }
      for (;;) {
        if (url.protocol !== "http:" && url.protocol !== "https:") {
          throw new FetchError("bad-url", `only http and https are fetched, not ${url.protocol}`);
        }
        const pinned = await pinAddress(url, controller.signal);
        if (controller.signal.aborted) throw new FetchError("timeout", `no complete response within ${limits.timeoutMs} ms`);
        if (used >= limits.budget) {
          throw new FetchError("budget-exhausted", `the run's budget of ${limits.budget} requests is spent`);
        }
        used++;
        const { res, body } = await requestOnce(url, pinned, controller.signal);
        if (body === undefined) {
          if (redirects.length >= limits.maxRedirects) {
            throw new FetchError("too-many-redirects", `more than ${limits.maxRedirects} redirects`);
          }
          let next: URL;
          try {
            next = new URL(res.headers.location!, url);
          } catch {
            throw new FetchError("bad-url", `bad redirect location: ${res.headers.location}`);
          }
          redirects.push(next.href);
          url = next;
          continue;
        }
        return {
          ok: true,
          url: input,
          status: res.statusCode ?? 0,
          headers: flattenHeaders(res),
          body,
          finalUrl: url.href,
          redirects,
        };
      }
    } catch (error) {
      const failure = error instanceof FetchError ? error : new FetchError("network", String(error));
      return { ok: false, url: input, error: failure.kind, message: failure.message, redirects };
    } finally {
      clearTimeout(timer);
    }
  }

  return { fetch, used: () => used, limits };
}
