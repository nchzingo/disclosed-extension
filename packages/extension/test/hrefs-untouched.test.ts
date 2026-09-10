/**
 * MANDATORY TEST 1 — after the content script runs, every anchor is
 * byte-identical to what the publisher served.
 *
 * THIS TEST IS THE COMPANY. HARD RULE 1: Disclosed never strips, replaces,
 * injects, rewrites, redirects or fires an affiliate link — not as a feature,
 * not as an option, not behind a flag. Socket documented 29 Chrome extensions
 * silently injecting their own affiliate tags over creators' codes; the Amazon
 * Associates Operating Agreement prohibits tag replacement; the Chrome Web
 * Store prohibits automatic affiliate injection. An extension that touched one
 * link would be the thing we exist to expose.
 *
 * It checks more than `href`. `outerHTML` of every anchor is captured before
 * and compared after, so an added attribute, a changed `rel`, a rewritten
 * `target`, or an element inserted INSIDE the anchor would fail it too. The
 * page deliberately contains badged links, unbadged links, links inside ranked
 * picks, a cloaked link, a relative link, a `mailto:`, a fragment, and an
 * anchor with no `href` at all.
 */
import { describe, expect, it } from 'vitest';
import { MARKER_ATTRIBUTE } from '../src/lib/marker.js';
import { page, scan } from './helpers.js';

const ARTICLE = `
  <p>We may earn a commission when you buy through links on our site.</p>
  <h2>1. Sony WH-1000XM5</h2>
  <p>
    <a href="https://www.amazon.com/dp/B0123?tag=disclosed-20" data-x="1">Check price</a>
    <a href="https://example.com/go/sony-wh1000xm5" rel="sponsored">Buy direct</a>
  </p>
  <h2>2. Bose QuietComfort Ultra</h2>
  <p>
    <a href="https://goto.walmart.com/c/12/34/56" target="_blank">Walmart</a>
    <a href="https://www.bose.com/qc-ultra?ref=example">Bose</a>
  </p>
  <h2>3. Apple AirPods Max</h2>
  <p>
    <a href="https://www.apple.com/airpods-max" rel="sponsored nofollow">Apple Store</a>
    <a href="https://amzn.to/3abcdef">Short link</a>
  </p>
  <p>
    <a href="https://en.wikipedia.org/wiki/Headphones">Wikipedia</a>
    <a href="/about-us">About</a>
    <a href="mailto:tips@example.com">Email us</a>
    <a href="#top">Back to top</a>
    <a>not a link at all</a>
  </p>
`;

interface AnchorSnapshot {
  outerHTML: string;
  attributeHref: string | null;
  resolvedHref: string;
  rel: string;
  attributes: string[];
}

function snapshotAnchors(doc: Document): AnchorSnapshot[] {
  return [...doc.querySelectorAll('a')].map((a) => ({
    outerHTML: a.outerHTML,
    attributeHref: a.getAttribute('href'),
    resolvedHref: a.href,
    rel: a.rel,
    attributes: [...a.attributes].map((attr) => `${attr.name}=${attr.value}`).sort(),
  }));
}

describe('HARD RULE 1 — the extension never touches a link', () => {
  it('leaves every anchor byte-identical after a scan that badges links', () => {
    const doc = page(ARTICLE);
    const before = snapshotAnchors(doc);

    const { report, badged } = scan(doc);

    // Guard against a vacuous pass: if nothing was badged, this test would be
    // asserting that a scan which did nothing changed nothing.
    expect(badged.length).toBeGreaterThanOrEqual(3);
    expect(report.badgedConfirmed).toBeGreaterThan(0);
    expect(report.badgedLikely).toBeGreaterThan(0);
    expect(doc.querySelectorAll(`[${MARKER_ATTRIBUTE}]`).length).toBe(badged.length);

    expect(snapshotAnchors(doc)).toEqual(before);
  });

  it('marks BESIDE the link: the marker is the anchor’s next sibling, outside it', () => {
    const doc = page(ARTICLE);
    const { badged } = scan(doc);
    for (const anchor of badged) {
      const marker = anchor.nextSibling as Element | null;
      expect(marker?.nodeType).toBe(1);
      expect((marker as Element).hasAttribute(MARKER_ATTRIBUTE)).toBe(true);
      // Nothing was inserted INSIDE the anchor.
      expect(anchor.querySelector(`[${MARKER_ATTRIBUTE}]`)).toBeNull();
    }
  });

  it('is idempotent: a second scan changes no anchor and adds no second marker', () => {
    const doc = page(ARTICLE);
    const { scanner, badged } = scan(doc);
    const afterFirst = snapshotAnchors(doc);
    const markersAfterFirst = doc.querySelectorAll(`[${MARKER_ATTRIBUTE}]`).length;

    scanner.scan();

    expect(snapshotAnchors(doc)).toEqual(afterFirst);
    expect(doc.querySelectorAll(`[${MARKER_ATTRIBUTE}]`).length).toBe(markersAfterFirst);
    expect(markersAfterFirst).toBe(badged.length);
  });

  it('leaves anchors untouched on a page where nothing is badged', () => {
    const doc = page(`
      <a href="https://en.wikipedia.org/wiki/Sony">Sony</a>
      <a href="https://www.bose.com/qc?ref=example">Bose</a>
      <a href="/local">Local</a>
    `);
    const before = snapshotAnchors(doc);
    const { badged } = scan(doc);
    expect(badged).toHaveLength(0);
    expect(snapshotAnchors(doc)).toEqual(before);
    expect(doc.querySelectorAll(`[${MARKER_ATTRIBUTE}]`)).toHaveLength(0);
  });

  it('never records itself on the anchor: a scanned anchor carries no marker attribute', () => {
    // De-duplication uses a WeakSet, not a DOM attribute, precisely so that a
    // scanned anchor is indistinguishable from an unscanned one.
    const doc = page(ARTICLE);
    scan(doc);
    for (const a of doc.querySelectorAll('a')) {
      for (const attr of a.attributes) {
        expect(attr.name.startsWith('data-disclosed')).toBe(false);
      }
    }
  });
});
