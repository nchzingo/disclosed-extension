/**
 * Applying a server-side resolution — the only path by which a cloaked link
 * ever gets marked.
 *
 * The resolution arrives as DATA and is handed to `classify()` as
 * `resolvedUrl`. The browser never follows the redirect: the reader's browser
 * must not fire the affiliate cookie, because hijacking a creator's commission
 * is the crime this project exists to expose (CLAUDE.md, Privacy architecture
 * point 3). Termination at a confirmed network yields `likely` for the
 * original link, never `confirmed` — one redirect hop of extra uncertainty.
 */
import { describe, expect, it } from 'vitest';
import { MARKER_ATTRIBUTE } from '../src/lib/marker.js';
import { page, scan } from './helpers.js';

const CLOAK = 'https://amzn.to/3abcdef';

describe('resolutions', () => {
  it('marks a cloak that resolves to an affiliate destination, at `likely`', () => {
    const doc = page(`<a href="${CLOAK}">Buy</a>`);
    const { scanner, badged } = scan(doc);
    expect(badged).toHaveLength(0);
    expect(scanner.pendingCloaks()).toEqual([CLOAK]);

    scanner.applyResolutions(new Map([[CLOAK, 'https://www.amazon.com/dp/B01?tag=disclosed-20']]));

    const report = scanner.report();
    expect(report.badgedLikely).toBe(1);
    expect(report.badgedConfirmed).toBe(0);
    expect(report.resolutionsApplied).toBe(1);
    expect(report.cloakedUnresolved).toBe(0);
    expect(doc.querySelectorAll(`[${MARKER_ATTRIBUTE}]`)).toHaveLength(1);
  });

  it('counts a resolution that lands somewhere unremarkable, and marks nothing', () => {
    const doc = page(`<a href="${CLOAK}">Read</a>`);
    const { scanner } = scan(doc);
    scanner.applyResolutions(new Map([[CLOAK, 'https://en.wikipedia.org/wiki/Headphones']]));

    const report = scanner.report();
    expect(report.badgedConfirmed + report.badgedLikely).toBe(0);
    expect(report.resolvedNotBadged).toBe(1);
    // No longer "destination unknown" — it is known, and it is not affiliate.
    expect(report.cloakedUnresolved).toBe(0);
    expect(doc.querySelectorAll(`[${MARKER_ATTRIBUTE}]`)).toHaveLength(0);
  });

  it('classifies PER ANCHOR, so one anchor’s `rel` cannot badge another', () => {
    // Same href, two anchors, one of them declared sponsored by the publisher.
    // Classifying once and applying the answer to both would badge the second
    // anchor on a declaration that was never made about it.
    const doc = page(
      `<a href="https://example.com/go/x" rel="sponsored">Declared</a>
       <a href="https://example.com/go/x">Not declared</a>`,
    );
    const { report, badged } = scan(doc);
    expect(badged).toHaveLength(1);
    expect(report.badgedLikely).toBe(1);
    expect(badged[0]?.textContent).toBe('Declared');
  });

  it('leaves an anchor untouched through a resolution', () => {
    const doc = page(`<a href="${CLOAK}" data-x="1">Buy</a>`);
    const before = [...doc.querySelectorAll('a')].map((a) => a.outerHTML);
    const { scanner } = scan(doc);
    scanner.applyResolutions(new Map([[CLOAK, 'https://www.amazon.com/dp/B01?tag=disclosed-20']]));
    expect([...doc.querySelectorAll('a')].map((a) => a.outerHTML)).toEqual(before);
  });

  it('ignores a resolution for a link this page never asked about', () => {
    const doc = page(`<a href="${CLOAK}">Buy</a>`);
    const { scanner } = scan(doc);
    scanner.applyResolutions(
      new Map([['https://never-seen.example/go/x', 'https://www.amazon.com/dp/B01?tag=x-20']]),
    );
    const report = scanner.report();
    expect(report.badgedConfirmed + report.badgedLikely).toBe(0);
    expect(report.cloakedUnresolved).toBe(1);
  });
});
