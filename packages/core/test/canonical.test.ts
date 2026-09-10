/**
 * §0.2 canonical URL + article id.
 *
 * Written BEFORE the implementation. The canonicalizer lives in core and is
 * imported by the crawler — written once, tested once, used by both. If the
 * crawler canonicalized even slightly differently, the same article would
 * draw two different ids across re-crawls and the longitudinal event study
 * (§5) could not align it.
 *
 * §0.2 rule under test, verbatim: scheme+host lowercased, default ports and
 * trailing slashes removed, tracking query params stripped, fragment removed.
 * Then id = SHA-256(canonical URL), hex.
 */
import { describe, expect, it } from 'vitest';
import {
  articleIdFromUrl,
  canonicalUrl,
  isTrackingParam,
  sha256Hex,
  CANON_RULES_VERSION,
  PROTECTED_LINK_PARAMS,
  TRACKING_PARAMS,
  TRACKING_PARAM_PREFIXES,
} from '../src/index.js';

describe('§0.2 canonicalUrl', () => {
  it('lowercases scheme and host, never the path', () => {
    expect(canonicalUrl('HTTPS://Example.COM/Best-Headphones')).toBe(
      'https://example.com/Best-Headphones',
    );
  });

  it('removes default ports, keeps explicit non-default ports', () => {
    expect(canonicalUrl('https://example.com:443/a')).toBe('https://example.com/a');
    expect(canonicalUrl('http://example.com:80/a')).toBe('http://example.com/a');
    expect(canonicalUrl('https://example.com:8443/a')).toBe('https://example.com:8443/a');
  });

  it('removes trailing slashes, including on the root', () => {
    expect(canonicalUrl('https://example.com/reviews/')).toBe('https://example.com/reviews');
    expect(canonicalUrl('https://example.com/reviews///')).toBe('https://example.com/reviews');
    expect(canonicalUrl('https://example.com/')).toBe('https://example.com');
  });

  it('removes the fragment', () => {
    expect(canonicalUrl('https://example.com/a#pick-3')).toBe('https://example.com/a');
  });

  it('strips tracking params and SORTS the remaining params by key (§0.2.1, byte-stability)', () => {
    expect(
      canonicalUrl('https://example.com/a?utm_source=nl&sort=price&fbclid=xyz&page=2'),
    ).toBe('https://example.com/a?page=2&sort=price');
    expect(canonicalUrl('https://example.com/a?z=1&a=2')).toBe('https://example.com/a?a=2&z=1');
    // repeated keys: sort is stable, value order within a key is preserved
    expect(canonicalUrl('https://example.com/a?b=1&a=2&a=1')).toBe(
      'https://example.com/a?a=2&a=1&b=1',
    );
  });

  it('§0.2.1: param order never changes the id', () => {
    expect(articleIdFromUrl('https://example.com/a?b=1&a=2')).toBe(
      articleIdFromUrl('https://example.com/a?a=2&b=1'),
    );
  });

  it('strips utm_* by prefix, case-insensitively', () => {
    expect(canonicalUrl('https://example.com/a?UTM_Campaign=x&Gclid=y&q=k')).toBe(
      'https://example.com/a?q=k',
    );
  });

  it('drops the query entirely when every param is tracking', () => {
    expect(canonicalUrl('https://example.com/a?utm_source=x&gclid=y')).toBe(
      'https://example.com/a',
    );
  });

  it('§0.2.2: the strip list is BYTE-EXACT against the canonical text, and versioned', () => {
    expect(TRACKING_PARAMS).toEqual([
      'gclid', 'gclsrc', 'gbraid', 'wbraid', 'dclid', 'srsltid', 'fbclid', 'msclkid',
      'twclid', 'ttclid', 'igshid', 'li_fat_id', 'yclid', 'epik', '_gl', 'mc_cid',
      'mc_eid', 'mkt_tok', '_hsenc', '_hsmi', 'hsCtaTracking', 'vero_id', 'vero_conv',
      '_openstat', 's_kwcid', 'ef_id', 'oly_anon_id', 'oly_enc_id', 'pk_campaign',
      'pk_kwd', 'piwik_campaign', 'piwik_kwd',
    ]);
    expect(TRACKING_PARAM_PREFIXES).toEqual(['utm_', 'mtm_', 'hsa_']);
    // v0.6.3 additions landed pre-first-row, INSIDE 1.0.0 — no bump, no recompute
    expect(CANON_RULES_VERSION).toBe('1.0.0');
  });

  it('§0.2.2 (v0.6.3): strips gclsrc, srsltid, _gl, mkt_tok — case-insensitively', () => {
    expect(
      canonicalUrl('https://example.com/a?gclsrc=aw&srsltid=Af1&_GL=1x&Mkt_Tok=abc&q=1'),
    ).toBe('https://example.com/a?q=1');
  });

  it('§0.2.2: isTrackingParam matches the canonical wording (names + prefixes, case-insensitive)', () => {
    expect(isTrackingParam('gclid')).toBe(true);
    expect(isTrackingParam('GCLSRC')).toBe(true);
    expect(isTrackingParam('hsctatracking')).toBe(true);
    expect(isTrackingParam('utm_anything')).toBe(true);
    expect(isTrackingParam('MTM_source')).toBe(true);
    expect(isTrackingParam('page')).toBe(false);
    expect(isTrackingParam('tag')).toBe(false);
    expect(isTrackingParam('ref')).toBe(false);
  });

  it('§0.2.2: strip matching is case-insensitive, including mixed-case listed names', () => {
    expect(canonicalUrl('https://example.com/a?hsctatracking=x&HSA_cam=1&q=k')).toBe(
      'https://example.com/a?q=k',
    );
  });

  it('§0.2.3 REGRESSION: unknown params ALWAYS survive untouched (strip-list, never keep-list)', () => {
    expect(canonicalUrl('https://example.com/a?foo=bar')).toBe('https://example.com/a?foo=bar');
    expect(canonicalUrl('https://example.com/a?page=2')).toBe('https://example.com/a?page=2');
    expect(canonicalUrl('https://example.com/a?variant=blue')).toBe(
      'https://example.com/a?variant=blue',
    );
    expect(canonicalUrl('https://example.com/a?model=x200&utm_id=9')).toBe(
      'https://example.com/a?model=x200',
    );
  });

  it('§0.2.4 REGRESSION: protected affiliate params are NEVER in the strip list', () => {
    // This test is what stops a future session from "tidying" the affiliate
    // evidence out of existence. The list is byte-exact against §0.2.4.
    expect(PROTECTED_LINK_PARAMS).toEqual([
      'tag', 'ascsubtag', 'linkCode', 'creativeASIN', 'ref', 'aff', 'affiliate',
      'partner', 'via', 'rfsn', 'irclickid', 'irgwc', 'awinmid', 'awinaffid',
      'murl', 'mid', 'sid', 'pid', 'clickref', 'afftrack', 'merchantID', 'userID',
    ]);
    const stripSet = new Set(TRACKING_PARAMS.map((p) => p.toLowerCase()));
    for (const p of PROTECTED_LINK_PARAMS) {
      const lower = p.toLowerCase();
      expect(stripSet.has(lower), `${p} must never be stripped`).toBe(false);
      for (const prefix of TRACKING_PARAM_PREFIXES) {
        expect(lower.startsWith(prefix), `${p} matches strip prefix ${prefix}`).toBe(false);
      }
    }
    // and the canonicalizer really does leave them alone
    expect(canonicalUrl('https://example.com/a?tag=site-20&ref=nav')).toBe(
      'https://example.com/a?ref=nav&tag=site-20',
    );
  });

  it('throws on invalid input and non-http(s) schemes', () => {
    expect(() => canonicalUrl('not a url')).toThrow();
    expect(() => canonicalUrl('mailto:x@example.com')).toThrow();
  });
});

describe('sha256Hex (pure TS, zero-dep)', () => {
  it('matches the NIST vectors', () => {
    expect(sha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    // 56 bytes: exercises the two-block padding path
    expect(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
  });

  it('always yields 64 lowercase hex chars', () => {
    expect(sha256Hex('https://example.com/a')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('§0.2 articleIdFromUrl', () => {
  it('is SHA-256 of the canonical URL', () => {
    const url = 'https://example.com/best-headphones?page=2';
    expect(articleIdFromUrl(url)).toBe(sha256Hex(canonicalUrl(url)));
  });

  it('assigns the SAME id to every non-canonical variant of an article', () => {
    const id = articleIdFromUrl('https://example.com/best-headphones');
    expect(articleIdFromUrl('HTTPS://EXAMPLE.com/best-headphones/')).toBe(id);
    expect(articleIdFromUrl('https://example.com:443/best-headphones#top')).toBe(id);
    expect(articleIdFromUrl('https://example.com/best-headphones?utm_source=tw&gclid=1')).toBe(id);
  });

  it('assigns DIFFERENT ids to genuinely different articles', () => {
    expect(articleIdFromUrl('https://example.com/best-headphones')).not.toBe(
      articleIdFromUrl('https://example.com/best-earbuds'),
    );
    expect(articleIdFromUrl('https://example.com/a?page=2')).not.toBe(
      articleIdFromUrl('https://example.com/a?page=3'),
    );
  });
});
