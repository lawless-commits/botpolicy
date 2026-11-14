import { isIPv4, isIPv6 } from "node:net";

/** IPv4 ranges that are never fetched: private, shared, loopback, link-local, reserved, multicast. */
const BLOCKED_V4: ReadonlyArray<[string, number]> = [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, cloud metadata
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // documentation
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation
  ["203.0.113.0", 24], // documentation
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved and broadcast
];

function v4ToNumber(ip: string): number | null {
  if (!isIPv4(ip)) return null;
  return ip.split(".").reduce((n, part) => n * 256 + Number(part), 0);
}

function v4FromNumber(n: number): string {
  return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");
}

function isPublicV4(ip: string): boolean {
  const n = v4ToNumber(ip);
  if (n === null) return false;
  return !BLOCKED_V4.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return ((n & mask) >>> 0) === ((v4ToNumber(base)! & mask) >>> 0);
  });
}

/** Expands an IPv6 address to a 128-bit integer, or null if it is not one. */
function v6ToBigInt(ip: string): bigint | null {
  if (!isIPv6(ip) || ip.includes("%")) return null;
  let text = ip.toLowerCase();
  const dotted = text.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const n = v4ToNumber(dotted[2]!);
    if (n === null) return null;
    text = `${dotted[1]}${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const [head, tail] = text.includes("::") ? text.split("::") : [text, undefined];
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const fill = tail === undefined ? [] : Array(8 - left.length - right.length).fill("0");
  const groups = [...left, ...fill, ...right];
  if (groups.length !== 8) return null;
  return groups.reduce((n, g) => (n << 16n) | BigInt(parseInt(g, 16)), 0n);
}

function inV6(n: bigint, prefix: string, bits: number): boolean {
  const base = v6ToBigInt(prefix)!;
  const shift = BigInt(128 - bits);
  return n >> shift === base >> shift;
}

function embeddedV4(n: bigint, shift: bigint): string {
  return v4FromNumber(Number((n >> shift) & 0xffffffffn));
}

function isPublicV6(ip: string): boolean {
  const n = v6ToBigInt(ip);
  if (n === null) return false;
  // Forms that carry an IPv4 address: judge the IPv4 address.
  if (inV6(n, "::ffff:0:0", 96)) return isPublicV4(embeddedV4(n, 0n)); // IPv4-mapped
  if (inV6(n, "64:ff9b::", 96)) return isPublicV4(embeddedV4(n, 0n)); // NAT64
  if (inV6(n, "2002::", 16)) return isPublicV4(embeddedV4(n, 80n)); // 6to4
  // Only global unicast is public, minus the special ranges inside it.
  if (!inV6(n, "2000::", 3)) return false; // loopback, unspecified, ::/96, ULA, link-local, multicast, NAT64 local
  if (inV6(n, "2001::", 32)) return false; // Teredo
  if (inV6(n, "2001:db8::", 32)) return false; // documentation
  return true;
}

/** True only for an IP address the fetcher may connect to. Hostnames and junk are false. */
export function isPublicAddress(ip: string): boolean {
  if (isIPv4(ip)) return isPublicV4(ip);
  if (isIPv6(ip)) return isPublicV6(ip);
  return false;
}
