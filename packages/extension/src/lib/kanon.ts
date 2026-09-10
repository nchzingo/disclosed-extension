/**
 * kanon.ts — the long-tail lookup, and the only network request this
 * extension is capable of making.
 *
 * WHAT LEAVES THE BROWSER: five hexadecimal characters. They are the first
 * five characters of the SHA-256 of a cloaked URL, and they are the whole of
 * the request — the path is `/v1/resolve/<prefix>`, there is no query string,
 * no body, no header we set, and no referrer. 5 hex characters is one of
 * 1,048,576 buckets; the server learns that some client asked about some URL
 * in a bucket and cannot learn which (the HaveIBeenPwned model, CLAUDE.md
 * Privacy architecture point 2).
 *
 * WHAT COMES BACK: every resolution the server holds in that bucket. The match
 * is completed HERE, in the browser, against the full 64-character hash. The
 * server is never told which of the entries it returned was the one we wanted,
 * and it is never told whether any of them was.
 *
 * WHAT NEVER HAPPENS: this extension never fetches a merchant URL, an
 * affiliate URL, or a redirector. Resolution is performed server-side,
 * cookieless, from clean IPs, long before a reader is involved
 * (CLAUDE.md Privacy architecture point 3) — the reader's browser must never
 * fire the affiliate cookie, because hijacking a creator's commission is the
 * crime this company exists to expose.
 *
 * WHAT HAPPENS WHEN IT FAILS: nothing visible. No toast, no retry, no second
 * attempt. A failed lookup leaves the link exactly where it was — unbadged,
 * counted as "cloaked, destination unknown", which is the honest state and the
 * state the corpus itself uses (docs/LABELING.md §3).
 */
import { sha256Hex } from '@disclosed/core/canonical';

/** Characters of the hash that leave the browser. Five. Not six. */
export const PREFIX_LENGTH = 5;

/** The ONLY shape that may be interpolated into a request path. */
export const PREFIX_PATTERN = /^[0-9a-f]{5}$/;

const FULL_HASH_PATTERN = /^[0-9a-f]{64}$/;

/** Entries accepted from one response before we stop reading it. */
const MAX_ENTRIES = 5000;

/** Distinct prefixes one page may ask about. */
export const MAX_PREFIXES_PER_PAGE = 25;

export interface ResolutionEntry {
  /** Full SHA-256 of the cloaked URL, hex. */
  hash: string;
  /** Where the server observed that URL to go. */
  destination: string;
}

export interface LookupOptions {
  /** Base URL of the API. Empty string disables lookups entirely. */
  apiBase: string;
  /** Injected so tests can observe the request and production can be audited. */
  fetchImpl: typeof fetch;
}

export function hashOf(url: string): string {
  return sha256Hex(url);
}

export function prefixOf(url: string): string {
  return sha256Hex(url).slice(0, PREFIX_LENGTH);
}

function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Entries from one response, strictly validated. Junk is dropped silently. */
export function parseEntries(payload: unknown): ResolutionEntry[] {
  if (typeof payload !== 'object' || payload === null) return [];
  const raw = (payload as { entries?: unknown }).entries;
  if (!Array.isArray(raw)) return [];
  const out: ResolutionEntry[] = [];
  for (const item of raw.slice(0, MAX_ENTRIES)) {
    if (typeof item !== 'object' || item === null) continue;
    const { hash, destination } = item as { hash?: unknown; destination?: unknown };
    if (typeof hash !== 'string' || !FULL_HASH_PATTERN.test(hash)) continue;
    if (typeof destination !== 'string' || !isHttpUrl(destination)) continue;
    out.push({ hash, destination });
  }
  return out;
}

/**
 * One bucket. Returns [] on anything at all going wrong.
 *
 * The request is built from a VALIDATED five-hex-character prefix and nothing
 * else. There is no code path here that can put a URL, a hash, a page title, a
 * publisher, a timestamp or an identifier into a request, because there is no
 * code path here that puts anything into a request.
 */
export async function fetchPrefix(
  prefix: string,
  { apiBase, fetchImpl }: LookupOptions,
): Promise<ResolutionEntry[]> {
  if (apiBase === '' || !PREFIX_PATTERN.test(prefix)) return [];
  const base = apiBase.replace(/\/+$/, '');
  try {
    const response = await fetchImpl(`${base}/v1/resolve/${prefix}`, {
      method: 'GET',
      // No cookies, no stored credentials, and no `Referer` naming the page
      // the reader is on. The request must carry nothing about the reader.
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
      mode: 'cors',
    });
    if (!response.ok) return [];
    return parseEntries((await response.json()) as unknown);
  } catch {
    // Silent. An unreachable API is not the reader's problem, and a retry
    // loop against a dead host is a network call we promised not to make.
    return [];
  }
}

/**
 * The buckets to ask about, and the full hashes to match against locally.
 *
 * Split out from the fetch because the two halves run in different places: the
 * content script computes this and sends ONLY `prefixes` to the background
 * worker, which is the process boundary the privacy claim is made across. The
 * `byHash` map — which contains the reader's actual URLs — never crosses it.
 */
export function prefixesFor(urls: readonly string[]): {
  prefixes: string[];
  byHash: Map<string, string>;
} {
  const byHash = new Map<string, string>();
  const prefixes = new Set<string>();
  for (const url of urls) {
    const hash = hashOf(url);
    byHash.set(hash, url);
    if (prefixes.size < MAX_PREFIXES_PER_PAGE) prefixes.add(hash.slice(0, PREFIX_LENGTH));
  }
  return { prefixes: [...prefixes], byHash };
}

/**
 * Complete the match locally, on the full 64-character hash.
 *
 * Everything else in the bucket belongs to somebody else's URL and is dropped
 * here, unread and unreported. That drop is the k-anonymity: the server sent
 * a thousand answers and never learns which one was wanted.
 */
export function matchEntries(
  byHash: ReadonlyMap<string, string>,
  entries: readonly ResolutionEntry[],
): Map<string, string> {
  const resolved = new Map<string, string>();
  for (const entry of entries) {
    const url = byHash.get(entry.hash);
    if (url !== undefined) resolved.set(url, entry.destination);
  }
  return resolved;
}

/**
 * Resolve as many of `urls` as the server happens to know, and no more.
 * The single-process form of the two functions above.
 */
export async function resolveUrls(
  urls: readonly string[],
  opts: LookupOptions,
): Promise<Map<string, string>> {
  if (opts.apiBase === '' || urls.length === 0) return new Map();
  const { prefixes, byHash } = prefixesFor(urls);
  const responses = await Promise.all(prefixes.map((p) => fetchPrefix(p, opts)));
  return matchEntries(byHash, responses.flat());
}
