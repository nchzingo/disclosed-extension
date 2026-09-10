/**
 * MANDATORY TEST 2 — `possible` is never badged. In any circumstance.
 *
 * The two ways a link lands in `possible` are both here, and they are
 * different mistakes to make:
 *
 *  1. **A bare `?ref=`.** `?ref=` is used constantly for non-affiliate
 *     tracking. It is noise, not evidence (CLAUDE.md). Badging it would put a
 *     marker on ordinary outbound links across the web.
 *  2. **`rel="sponsored"` to a domain that is not the publisher's**
 *     (`publisher_declared_direct`, ruling 2026-09-07b). `rel="sponsored"` is
 *     the correct attribute for paid placement that pays no commission at all,
 *     so badging it would mark a publisher for COMPLYING with 16 CFR 255.
 *     This is the ruling that removed five badges and prevented a §8 gate
 *     failure; a test that let them back is a test that undoes it.
 *
 * `possible` links are counted — the reader is told we saw something and
 * declined to call it anything — and never marked.
 */
import { describe, expect, it } from 'vitest';
import { classify, shouldBadge } from '@disclosed/core';
import { MARKER_ATTRIBUTE } from '../src/lib/marker.js';
import { page, ruleset, scan } from './helpers.js';

const PUBLISHER = 'https://example.com/best-headphones';

describe('`possible` is never badged', () => {
  it('classifies the two shapes as `possible` in the first place', () => {
    const bareRef = classify('https://www.bose.com/qc-ultra?ref=example', ruleset, {
      rel: null,
      sourceUrl: PUBLISHER,
    });
    expect(bareRef.tier).toBe('possible');

    const crossDomainSponsored = classify('https://www.apple.com/airpods-max', ruleset, {
      rel: 'sponsored',
      sourceUrl: PUBLISHER,
    });
    expect(crossDomainSponsored.tier).toBe('possible');
    expect(crossDomainSponsored.network).toBe('publisher_declared_direct');

    expect(shouldBadge('possible')).toBe(false);
    expect(shouldBadge('none')).toBe(false);
  });

  it('adds no marker for either shape, and counts both', () => {
    const doc = page(
      `
        <a href="https://www.bose.com/qc-ultra?ref=example">Bose</a>
        <a href="https://www.apple.com/airpods-max" rel="sponsored">Apple</a>
        <a href="https://shop.sony.com/headphones?aff=example">Sony</a>
      `,
      PUBLISHER,
    );
    const { report, badged } = scan(doc);

    expect(badged).toHaveLength(0);
    expect(report.badgedConfirmed).toBe(0);
    expect(report.badgedLikely).toBe(0);
    expect(doc.querySelectorAll(`[${MARKER_ATTRIBUTE}]`)).toHaveLength(0);
    // The cross-domain declaration is counted exactly: every `rel="sponsored"`
    // anchor is admitted, so `declaredNotBadged` is complete.
    expect(report.declaredNotBadged).toBe(1);
    expect(report.possibleNotBadged).toBeGreaterThanOrEqual(1);
    // And the shapes whose ONLY signal is a bare `?ref=` / `?aff=` are never
    // handed to the classifier at all — a deliberate prefilter decision
    // (lib/trie.ts): they can never be badged, so counting them would be
    // per-link work spent on a number we would not act on. The popup says the
    // count is a floor rather than a total; it does not quietly imply zero.
    expect(report.possibleNotBadged).toBeLessThan(3);
  });

  it('badges the SAME declaration when it points at the publisher’s own domain', () => {
    // The other half of the 2026-09-07b ruling, kept in the same test file so
    // the two halves cannot drift apart: same attribute, different domain,
    // different tier. `likely`, network `publisher_cloak`.
    const doc = page(
      `<a href="https://example.com/go/sony" rel="sponsored">Buy</a>`,
      PUBLISHER,
    );
    const { report, badged } = scan(doc);
    expect(badged).toHaveLength(1);
    expect(report.badgedLikely).toBe(1);
    expect(report.byNetwork['publisher_cloak']).toBe(1);
  });

  it('never badges a cloaked link whose destination is unknown', () => {
    // A cloak path is a hint that the destination is unresolved. It is not
    // evidence, and an unresolved cloak stays unbadged and is counted as
    // unknown — never as unmonetized (docs/LABELING.md §3).
    const doc = page(
      `<a href="https://amzn.to/3abcdef">Short link</a>
       <a href="https://otherblog.example.org/recommends/thing">Cloak</a>`,
      PUBLISHER,
    );
    const { report, badged } = scan(doc);
    expect(badged).toHaveLength(0);
    expect(report.cloakedUnresolved).toBeGreaterThanOrEqual(1);
  });
});
