/**
 * Deterministic, seeded RNG for the §2.2 article-set bootstrap and the §1.6
 * SPP permutation test. Zero dependencies. Never Math.random().
 *
 * ────────────────────────────────────────────────────────────────────────────
 * PUBLISHED RNG SPECIFICATION — this block is destined for /methodology.
 * A third party following it must reproduce our numbers bit for bit.
 *
 * Generator      xorshift128 (Marsaglia 2003), 32-bit variant. State is four
 *                uint32 words (x, y, z, w). Each step:
 *                    t = x ^ (x << 11)            (uint32, wrapping)
 *                    x = y; y = z; z = w
 *                    w = (w ^ (w >>> 19)) ^ (t ^ (t >>> 8))
 *                and w is the output.
 *
 * Seeding        The four state words are the first four outputs of a
 *                splitmix32 sequence whose state starts at
 *                    (BOOTSTRAP_SEED ^ domain ^ contentHash) >>> 0.
 *                splitmix32 step: s += 0x9E3779B9; z = s;
 *                z ^= z >>> 16; z *= 0x21F0AAAD (wrapping);
 *                z ^= z >>> 15; z *= 0x735A2D97 (wrapping);
 *                z ^= z >>> 15; output z >>> 0.
 *                If all four words seed to zero, w is set to 1.
 *
 * Seed           BOOTSTRAP_SEED = 0xD15C105E. Fixed. Published. Changing it is
 *                a public, versioned event.
 *
 * Domains        ARTICLE_STREAM_DOMAIN = 0x41525431 ("ART1") for the §2.2
 *                article-set bootstrap; SPP_STREAM_DOMAIN = 0x53505031
 *                ("SPP1") for the §1.6 permutation. Domain separation
 *                guarantees the two procedures never share a stream even on
 *                colliding content hashes.
 *
 * Stream         contentHash is FNV-1a (32-bit, offset 0x811C9DC5, prime
 * derivation     0x01000193) over a canonical byte serialization:
 *                 - §2.2 article bootstrap: the qualifying articles' `id`s
 *                   (§0.2: SHA-256 hex of the canonical URL) sorted ascending
 *                   (code-unit order), UTF-8 encoded, joined with "\n". Keyed
 *                   to article IDENTITY, not ρ-content, so two publishers
 *                   sharing a ρ_a multiset still draw distinct streams;
 *                 - §1.6 SPP permutation: the (n_a, q_a) list sorted ascending
 *                   by (n, q), each value as int32 little-endian.
 *                Streams are derived from stable identity/content, not
 *                processing order, so results are independent of crawl or
 *                corpus ordering.
 *
 * Draws          A uniform index in [0, n) is floor((out / 2^32) · n), where
 *                out is the uint32 generator output. Resample b of the §2.2
 *                article bootstrap consumes exactly n consecutive draws
 *                (n = |Q_p|), b = 0..B−1 in order; each draw indexes the
 *                article list sorted by `id` ascending and takes that
 *                article's ρ_a. Simulation b of the §1.6 permutation consumes
 *                one draw per article in canonical order, b = 0..B−1.
 * ────────────────────────────────────────────────────────────────────────────
 */

/** Published seed for all §1.6/§2.2 resampling. Changing it is a public event. */
export const BOOTSTRAP_SEED = 0xd15c105e;

/** Stream domain for the §2.2 article-set bootstrap ("ART1"). */
export const ARTICLE_STREAM_DOMAIN = 0x41525431;

/** Stream domain for the §1.6 SPP permutation ("SPP1"). */
export const SPP_STREAM_DOMAIN = 0x53505031;

/** FNV-1a 32-bit hash over raw bytes. */
export function fnv1a32(bytes: Uint8Array): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i]!;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Canonical content hash of (int32, float64) pairs. */
export function hashPairs(pairs: readonly (readonly [number, number])[]): number {
  const buf = new ArrayBuffer(pairs.length * 12);
  const view = new DataView(buf);
  let offset = 0;
  for (const [i, v] of pairs) {
    view.setInt32(offset, i, true);
    view.setFloat64(offset + 4, v, true);
    offset += 12;
  }
  return fnv1a32(new Uint8Array(buf));
}

/**
 * Canonical hash of a string list (§2.2 article-id streams): FNV-1a over the
 * UTF-8 bytes of the strings joined with "\n". Callers pass the ids already
 * sorted ascending.
 */
export function hashStrings(strings: readonly string[]): number {
  return fnv1a32(new TextEncoder().encode(strings.join('\n')));
}

/** Canonical content hash of an int32 list. */
export function hashInts(ints: readonly number[]): number {
  const buf = new ArrayBuffer(ints.length * 4);
  const view = new DataView(buf);
  for (let i = 0; i < ints.length; i++) view.setInt32(i * 4, ints[i]!, true);
  return fnv1a32(new Uint8Array(buf));
}

function splitmix32(state: { s: number }): number {
  state.s = (state.s + 0x9e3779b9) >>> 0;
  let z = state.s;
  z ^= z >>> 16;
  z = Math.imul(z, 0x21f0aaad);
  z ^= z >>> 15;
  z = Math.imul(z, 0x735a2d97);
  z ^= z >>> 15;
  return z >>> 0;
}

export interface Rng {
  nextUint32(): number;
  /** Uniform integer in [0, n): floor((out / 2^32) · n). */
  nextIndex(n: number): number;
}

/** xorshift128 stream keyed by (seed, domain, content hash). See header. */
export function createStream(seed: number, domain: number, contentHash: number): Rng {
  const sm = { s: (seed ^ domain ^ contentHash) >>> 0 };
  let x = splitmix32(sm);
  let y = splitmix32(sm);
  let z = splitmix32(sm);
  let w = splitmix32(sm);
  if ((x | y | z | w) === 0) w = 1;

  const nextUint32 = (): number => {
    const t = (x ^ (x << 11)) >>> 0;
    x = y;
    y = z;
    z = w;
    w = ((w ^ (w >>> 19)) ^ (t ^ (t >>> 8))) >>> 0;
    return w;
  };

  return {
    nextUint32,
    nextIndex: (n: number): number => Math.floor((nextUint32() / 4294967296) * n),
  };
}
