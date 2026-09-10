/**
 * §0.2 Article identity: canonical URL + SHA-256 article id.
 *
 * Lives in core (pure string work, zero dependencies) and is imported by the
 * crawler — written once, tested once, used by both. If the crawler
 * canonicalized even slightly differently, the same article would draw two
 * different ids across re-crawls and the §5 longitudinal event study could
 * not align it.
 *
 * This module deliberately imports NOTHING from the rest of core. It is
 * exposed as the `@disclosed/core/canonical` subpath so the blind harvester
 * can import it without the classifier ever entering its module graph
 * (blindness enforced structurally, not by discipline).
 *
 * §0.2.1 canonicalization rule, verbatim: (1) scheme+host lowercased,
 * (2) default ports removed, (3) fragment removed, (4) trailing slash removed
 * from the path, (5) tracking params stripped per the §0.2.2 published list,
 * remaining params sorted by key for byte-stability. Then id = SHA-256 of the
 * canonical URL, hex-encoded.
 */

/**
 * §0.2.2 — the published, VERSIONED tracking-param strip list, byte-exact
 * against the canonical spec text. The id bytes depend on it. Matching is
 * case-insensitive. Ids are comparable only within a CANON_RULES_VERSION;
 * growing the list requires recomputing the ENTIRE corpus in one pass and
 * bumping the version (raw URLs are stored on every record, so ids are
 * derived data and wholesale recompute is safe).
 *
 * §0.2.3 — strip-list, NEVER keep-list. Unknown params always survive:
 * under-stripping fragments one article into two ids (recoverable);
 * over-stripping merges two different articles into one id (corruption).
 */
export const CANON_RULES_VERSION = '1.0.0';

export const TRACKING_PARAM_PREFIXES: readonly string[] = ['utm_', 'mtm_', 'hsa_'];
export const TRACKING_PARAMS: readonly string[] = [
  'gclid',
  'gclsrc',
  'gbraid',
  'wbraid',
  'dclid',
  'srsltid',
  'fbclid',
  'msclkid',
  'twclid',
  'ttclid',
  'igshid',
  'li_fat_id',
  'yclid',
  'epik',
  '_gl',
  'mc_cid',
  'mc_eid',
  'mkt_tok',
  '_hsenc',
  '_hsmi',
  'hsCtaTracking',
  'vero_id',
  'vero_conv',
  '_openstat',
  's_kwcid',
  'ef_id',
  'oly_anon_id',
  'oly_enc_id',
  'pk_campaign',
  'pk_kwd',
  'piwik_campaign',
  'piwik_kwd',
];

/**
 * §0.2.4 — the canonicalizer identifies ARTICLES and must never touch an
 * outbound link before classification: affiliate signal lives in exactly the
 * params a canonicalizer removes. These params may NEVER enter the strip
 * list; test/canonical.test.ts enforces disjointness byte-exactly.
 */
export const PROTECTED_LINK_PARAMS: readonly string[] = [
  'tag',
  'ascsubtag',
  'linkCode',
  'creativeASIN',
  'ref',
  'aff',
  'affiliate',
  'partner',
  'via',
  'rfsn',
  'irclickid',
  'irgwc',
  'awinmid',
  'awinaffid',
  'murl',
  'mid',
  'sid',
  'pid',
  'clickref',
  'afftrack',
  'merchantID',
  'userID',
];

const TRACKING_SET = new Set(TRACKING_PARAMS.map((p) => p.toLowerCase()));

/**
 * §0.2.2: true when a query-param name is on the strip list (exact name or
 * prefix). Matching on names is case-insensitive, per the canonical text.
 * Exported so the harvester's param census can mark already-stripped params.
 */
export function isTrackingParam(name: string): boolean {
  const lower = name.toLowerCase();
  return TRACKING_SET.has(lower) || TRACKING_PARAM_PREFIXES.some((p) => lower.startsWith(p));
}

/** §0.2 canonical URL. Throws on invalid or non-http(s) input. */
export function canonicalUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new TypeError(`canonicalUrl: not a valid URL: ${raw}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new TypeError(`canonicalUrl: articles are http(s) URLs, got scheme ${url.protocol}`);
  }

  // URL already lowercases scheme+host and drops default ports (80/443).
  const path = url.pathname.replace(/\/+$/, '');

  const kept: [string, string][] = [];
  for (const [name, value] of url.searchParams) {
    if (isTrackingParam(name)) continue;
    kept.push([name, value]);
  }
  // §0.2.1 step 5: retained params sorted by key for byte-stability (stable
  // sort — repeated keys keep their value order).
  kept.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const query = kept.length > 0 ? `?${new URLSearchParams(kept).toString()}` : '';

  return `${url.protocol}//${url.host}${path}${query}`;
}

/** §0.2 article id: SHA-256 of the canonical URL, hex-encoded. */
export function articleIdFromUrl(url: string): string {
  return sha256Hex(canonicalUrl(url));
}

// ---------------------------------------------------------------------------
// SHA-256 — pure TypeScript (FIPS 180-4), zero dependencies, synchronous.
// Hand-rolled because core must run identically in Node, workers, and the
// extension with no platform crypto dependency, and must be auditable line by
// line. Verified against the NIST test vectors in test/canonical.test.ts —
// a transcription error in any constant fails those vectors.
// ---------------------------------------------------------------------------

/* eslint-disable no-bitwise */

// First 32 bits of the fractional parts of the cube roots of the first 64 primes.
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

/** SHA-256 of a UTF-8 string, lowercase hex. */
export function sha256Hex(input: string): string {
  const data = new TextEncoder().encode(input);

  // Padding: 0x80, zeros, then the 64-bit big-endian bit length.
  const bitLenLo = (data.length << 3) >>> 0;
  const bitLenHi = Math.floor(data.length / 0x20000000); // length * 8 / 2^32
  const paddedLen = (((data.length + 8) >> 6) + 1) << 6;
  const padded = new Uint8Array(paddedLen);
  padded.set(data);
  padded[data.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLen - 8, bitLenHi, false);
  view.setUint32(paddedLen - 4, bitLenLo, false);

  // Initial hash: first 32 bits of the fractional parts of the square roots
  // of the first 8 primes.
  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  const w = new Uint32Array(64);
  for (let offset = 0; offset < paddedLen; offset += 64) {
    for (let t = 0; t < 16; t++) w[t] = view.getUint32(offset + t * 4, false);
    for (let t = 16; t < 64; t++) {
      const s0 = rotr(w[t - 15]!, 7) ^ rotr(w[t - 15]!, 18) ^ (w[t - 15]! >>> 3);
      const s1 = rotr(w[t - 2]!, 17) ^ rotr(w[t - 2]!, 19) ^ (w[t - 2]! >>> 10);
      w[t] = (w[t - 16]! + s0 + w[t - 7]! + s1) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let t = 0; t < 64; t++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[t]! + w[t]!) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((word) => word.toString(16).padStart(8, '0'))
    .join('');
}
