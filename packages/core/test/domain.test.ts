/**
 * registrableDomain — the identity test behind the publisher declaration rule
 * (docs/LABELING.md §2 rule 5, amended 2026-09-07b).
 *
 * The table here is a DELIBERATELY PARTIAL public suffix list. The tests
 * therefore assert two different things and keep them apart:
 *
 *  1. that the reductions we rely on are right (`cc.cnet.com` and
 *     `www.cnet.com` are one publisher; `theobjectcollective.com.au` and
 *     `nymag.com` are two);
 *  2. that every way the table can be WRONG fails toward withholding a badge —
 *     an unknown suffix must never make two strangers look like one domain.
 */
import { describe, expect, it } from 'vitest';
import {
  publicSuffixLabelCount,
  registrableDomain,
  registrableDomainOfUrl,
  sameRegistrableDomain,
  MULTI_LABEL_PUBLIC_SUFFIXES,
} from '../src/index.js';

describe('registrableDomain: the ordinary single-label TLD', () => {
  it('reduces a host to eTLD+1', () => {
    expect(registrableDomain('cnet.com')).toBe('cnet.com');
    expect(registrableDomain('www.cnet.com')).toBe('cnet.com');
    expect(registrableDomain('cc.cnet.com')).toBe('cnet.com');
    expect(registrableDomain('deals.shop.cnet.com')).toBe('cnet.com');
    expect(registrableDomain('www.nytimes.com')).toBe('nytimes.com');
  });

  it('treats a long TLD as one label', () => {
    expect(registrableDomain('play.date')).toBe('play.date');
    expect(registrableDomain('shop.play.date')).toBe('play.date');
    expect(registrableDomain('example.app')).toBe('example.app');
  });

  it('is case- and trailing-dot-insensitive', () => {
    expect(registrableDomain('WWW.CNET.COM.')).toBe('cnet.com');
  });
});

describe('registrableDomain: multi-label public suffixes', () => {
  it('handles the ccTLD shape generically, without enumerating registries', () => {
    expect(registrableDomain('theobjectcollective.com.au')).toBe('theobjectcollective.com.au');
    expect(registrableDomain('www.theobjectcollective.com.au')).toBe('theobjectcollective.com.au');
    expect(registrableDomain('bbc.co.uk')).toBe('bbc.co.uk');
    expect(registrableDomain('news.bbc.co.uk')).toBe('bbc.co.uk');
    expect(registrableDomain('example.co.jp')).toBe('example.co.jp');
    expect(registrableDomain('shop.example.com.br')).toBe('example.com.br');
    expect(publicSuffixLabelCount('theobjectcollective.com.au')).toBe(2);
  });

  it('does NOT apply the ccTLD shape under a long TLD', () => {
    // "com" before a 3+ letter TLD is an ordinary label, not a suffix.
    expect(registrableDomain('shop.com.systems')).toBe('com.systems');
    expect(publicSuffixLabelCount('shop.com.systems')).toBe(1);
  });

  it('applies the explicit shared-hosting table', () => {
    expect(registrableDomain('brandshop.myshopify.com')).toBe('brandshop.myshopify.com');
    expect(registrableDomain('someone.github.io')).toBe('someone.github.io');
    for (const suffix of MULTI_LABEL_PUBLIC_SUFFIXES) {
      // a bare public suffix has no registrable domain of its own
      expect(registrableDomain(suffix), suffix).toBeNull();
    }
  });
});

describe('registrableDomain: refuses rather than guesses', () => {
  it('answers null for anything it cannot reduce', () => {
    expect(registrableDomain('')).toBeNull();
    expect(registrableDomain('localhost')).toBeNull();
    expect(registrableDomain('com')).toBeNull();
    expect(registrableDomain('com.au')).toBeNull();
    expect(registrableDomain('192.168.0.1')).toBeNull();
    expect(registrableDomain('[::1]')).toBeNull();
    expect(registrableDomain('a..b.com')).toBeNull();
    expect(registrableDomain(undefined as unknown as string)).toBeNull();
  });

  it('registrableDomainOfUrl rejects non-http(s) and malformed input', () => {
    expect(registrableDomainOfUrl('https://cc.cnet.com/v1/otc/x')).toBe('cnet.com');
    expect(registrableDomainOfUrl('javascript:alert(1)')).toBeNull();
    expect(registrableDomainOfUrl('mailto:a@b.com')).toBeNull();
    expect(registrableDomainOfUrl('not a url')).toBeNull();
  });
});

describe('sameRegistrableDomain: the safety direction', () => {
  it('is true for a publisher and its own subdomain redirector', () => {
    expect(sameRegistrableDomain('cc.cnet.com', 'www.cnet.com')).toBe(true);
    expect(sameRegistrableDomain('www.nytimes.com', 'nytimes.com')).toBe(true);
  });

  it('is false across publishers and across merchants', () => {
    expect(sameRegistrableDomain('austinair.com', 'nymag.com')).toBe(false);
    expect(sameRegistrableDomain('play.date', 'nymag.com')).toBe(false);
    expect(sameRegistrableDomain('www.onepeloton.com', 'nymag.com')).toBe(false);
  });

  it('DOES NOT collide two strangers under a shared multi-label suffix', () => {
    // The failure this whole module exists to prevent: reducing both sides to
    // the suffix itself and badging one company's link on another's page.
    expect(sameRegistrableDomain('shop.com.au', 'smh.com.au')).toBe(false);
    expect(sameRegistrableDomain('merchant.co.uk', 'publisher.co.uk')).toBe(false);
    expect(sameRegistrableDomain('merchant.myshopify.com', 'publisher.myshopify.com')).toBe(false);
  });

  it('answers false whenever either side cannot be reduced — never true', () => {
    expect(sameRegistrableDomain('com.au', 'com.au')).toBe(false);
    expect(sameRegistrableDomain('localhost', 'localhost')).toBe(false);
    expect(sameRegistrableDomain('192.168.0.1', '192.168.0.1')).toBe(false);
    expect(sameRegistrableDomain('', '')).toBe(false);
  });

  it('an UNKNOWN suffix over-reduces at worst by one label, and that withholds', () => {
    // `zw` is a real ccTLD we do not enumerate; the generic rule catches
    // `co.zw` because `co` is a generic second level. A registry shape we do
    // NOT catch would make two strangers equal — so assert the generic rule
    // covers the shapes that actually exist in the wild.
    expect(sameRegistrableDomain('merchant.co.zw', 'publisher.co.zw')).toBe(false);
    expect(sameRegistrableDomain('merchant.org.za', 'publisher.org.za')).toBe(false);
    expect(sameRegistrableDomain('merchant.ne.jp', 'publisher.ne.jp')).toBe(false);
    expect(sameRegistrableDomain('merchant.ac.nz', 'publisher.ac.nz')).toBe(false);
  });
});
