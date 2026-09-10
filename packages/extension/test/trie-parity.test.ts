/**
 * MANDATORY TEST 5 — the prefilter admits everything `classify()` badges.
 *
 * THE DIRECTION THAT MATTERS. A prefilter that admits too much costs one
 * function call per extra link. A prefilter that admits too LITTLE drops a
 * badge that the classifier would have applied, on a page nobody is looking
 * at, and no test of the classifier can see it — the classifier was never
 * called. That is a silent recall bug, and it is the only failure this file
 * treats as fatal.
 *
 * Run over 550 real corpus links (test/fixtures/corpus-sample.json,
 * deterministically sampled and stratified by tier — see
 * tools/build-corpus-fixture.mjs), plus hand-written cases for the matching
 * rules that are easy to get subtly wrong.
 *
 * THE OTHER DIRECTION IS BOUNDED, NOT ZERO, AND THE ALLOWED CASES ARE NAMED.
 * A link the prefilter admits and `classify()` calls `none` must fall into one
 * of four categories, each of them a deliberate decision made in lib/trie.ts:
 *
 *   requires_resolution     amzn.to and friends — admitted as k-anonymity
 *                           candidates precisely BECAUSE classify() cannot
 *                           judge them unaided.
 *   path_constraint_unmet   shareasale.com/about — the trie does not look at
 *                           paths, on purpose; classify() throws it out.
 *   declaration_unattributable  rel="sponsored" with no usable source domain.
 *   merchant_param_only     a merchant domain carrying the param NAME but no
 *                           value (classify() requires a non-empty value).
 *
 * An admitted link that fits none of them fails this test, which is what makes
 * "explicitly allowed" mean something.
 */
import { describe, expect, it } from 'vitest';
import { classify, shouldBadge, type Classification } from '@disclosed/core';
import { ADMIT_DECLARATION, buildPrefilter, type LinkFacts } from '../src/lib/prefilter.js';
import { ADMIT_MERCHANT_PARAM, ADMIT_REQUIRES_RESOLUTION } from '../src/lib/trie.js';
import { corpusSample, prefilter, ruleset } from './helpers.js';

function factsOf(href: string, rel: string | null): LinkFacts | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  return {
    href,
    protocol: url.protocol,
    hostname: url.hostname,
    pathname: url.pathname,
    search: url.search,
    rel,
  };
}

type Category =
  | 'requires_resolution'
  | 'path_constraint_unmet'
  | 'declaration_unattributable'
  | 'merchant_param_only';

/** Why an admitted link came back `none`, or null if there is no good reason. */
function falsePositiveCategory(c: Classification, admit: number): Category | null {
  const kinds = new Set(c.evidence.map((e) => e.kind));
  if ((admit & ADMIT_REQUIRES_RESOLUTION) !== 0 && kinds.has('requires_resolution')) {
    return 'requires_resolution';
  }
  if (kinds.has('path_required_unmet')) return 'path_constraint_unmet';
  if (kinds.has('publisher_declared_unattributable')) return 'declaration_unattributable';
  if (admit === ADMIT_MERCHANT_PARAM) return 'merchant_param_only';
  return null;
}

describe('the prefilter never drops a link the classifier would badge', () => {
  const sample = corpusSample();

  it('has a sample to run against', () => {
    expect(sample.links.length).toBeGreaterThanOrEqual(400);
  });

  it('admits every badged corpus link', () => {
    const dropped: string[] = [];
    let badged = 0;
    for (const link of sample.links) {
      const c = classify(link.href, ruleset, { rel: link.rel, sourceUrl: link.sourceUrl });
      if (!shouldBadge(c.tier)) continue;
      badged++;
      const facts = factsOf(link.href, link.rel);
      if (facts === null || prefilter.admit(facts) === 0) dropped.push(link.href);
    }
    expect(badged).toBeGreaterThan(100);
    expect(dropped).toEqual([]);
  });

  it('admits nothing it cannot account for', () => {
    const unexplained: string[] = [];
    const counts: Record<string, number> = {};
    for (const link of sample.links) {
      const facts = factsOf(link.href, link.rel);
      if (facts === null) continue;
      const admit = prefilter.admit(facts);
      if (admit === 0) continue;
      const c = classify(link.href, ruleset, { rel: link.rel, sourceUrl: link.sourceUrl });
      if (c.tier !== 'none') {
        counts[c.tier] = (counts[c.tier] ?? 0) + 1;
        continue;
      }
      const category = falsePositiveCategory(c, admit);
      if (category === null) unexplained.push(`${link.href} (admit=${admit})`);
      else counts[category] = (counts[category] ?? 0) + 1;
    }
    expect(unexplained).toEqual([]);
    // The prefilter is doing real work: most of what it admits is classified.
    const classified =
      (counts.confirmed ?? 0) + (counts.likely ?? 0) + (counts.possible ?? 0);
    expect(classified).toBeGreaterThan(0);
  });

  it('rejects the great majority of ordinary links', () => {
    // Not a correctness property — a performance one. If the prefilter
    // admitted everything it would be a slower way of calling classify().
    const total = sample.links.length;
    let admitted = 0;
    for (const link of sample.links) {
      const facts = factsOf(link.href, link.rel);
      if (facts !== null && prefilter.admit(facts) !== 0) admitted++;
    }
    expect(admitted).toBeLessThan(total);
  });
});

describe('host matching mirrors core, including the parts that are easy to get wrong', () => {
  const admit = (href: string, rel: string | null = null): number => {
    const facts = factsOf(href, rel);
    return facts === null ? 0 : prefilter.admit(facts);
  };

  it('matches an exact host pattern through a leading www.', () => {
    expect(admit('https://anrdoezrs.net/links/1/type/dlg/')).not.toBe(0);
    expect(admit('https://www.anrdoezrs.net/links/1/type/dlg/')).not.toBe(0);
  });

  it('matches a wildcard on a subdomain but not on the apex', () => {
    // `*.pxf.io` in core matches subdomains and never the apex.
    expect(admit('https://sony.pxf.io/c/1/2/3')).not.toBe(0);
    expect(admit('https://pxf.io/')).toBe(0);
    // …and `www.pxf.io` IS a subdomain, which is why both host forms are
    // walked. Dropping the unstripped walk would lose this one.
    expect(admit('https://www.pxf.io/c/1/2/3')).not.toBe(0);
  });

  it('does not admit an unrelated host that merely ends in a pattern label', () => {
    expect(admit('https://notpxf.io/')).toBe(0);
    expect(admit('https://example.com/pxf.io')).toBe(0);
  });

  it('gates a merchant domain on its affiliate param', () => {
    expect(admit('https://www.amazon.com/dp/B0123?tag=disclosed-20')).toBe(ADMIT_MERCHANT_PARAM);
    expect(admit('https://www.amazon.com/dp/B0123')).toBe(0);
    // Subdomains of the merchant domain count, as they do in core.
    expect(admit('https://smile.amazon.com/dp/B0123?tag=x')).toBe(ADMIT_MERCHANT_PARAM);
  });

  it('admits a `rel="sponsored"` anchor on any host, because the trie cannot see one', () => {
    // The declaration rule keys on the pair (link domain, article domain), so
    // no host trie can decide it. Losing this admission would drop every
    // publisher_cloak badge on the page.
    expect(admit('https://example.com/go/thing', 'sponsored')).toBe(ADMIT_DECLARATION);
    expect(admit('https://example.com/go/thing', 'nofollow')).toBe(0);
    expect(admit('https://example.com/go/thing', 'SPONSORED nofollow')).toBe(ADMIT_DECLARATION);
  });

  it('admits nothing for non-http(s) links', () => {
    expect(admit('mailto:tips@example.com')).toBe(0);
    expect(admit('javascript:void(0)')).toBe(0);
  });

  it('compiles a matcher, not a pile of regexes', () => {
    const compiled = buildPrefilter(ruleset);
    expect(compiled.trie.patternCount).toBeGreaterThan(20);
  });
});
