/**
 * The page facts the popup reports, and the two copies this package keeps of
 * crawler code.
 *
 * A COPY THAT CANNOT DRIFT UNNOTICED. `DISCLOSURE_REGEX_SOURCE` and
 * `parsePickNumber` are duplicated from `packages/crawler/src/extract.ts`
 * because the crawler depends on Playwright and nothing that ships to a
 * reader's browser may. The first is checked here against the crawler's own
 * source file, character for character. The second is pinned against the same
 * cases the crawler's tests use, including the range guard that stopped a
 * phantom pick on the Class A Wikipedia control.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DISCLOSURE_REGEX_SOURCE, findDisclosure } from '../src/lib/disclosure.js';
import { collectPicks, parsePickNumber } from '../src/lib/picks.js';
import { createMarker, markerTitle, MARKER_ATTRIBUTE } from '../src/lib/marker.js';
import { describeDisclosure, describePage } from '../src/lib/panel.js';
import { page, REPO_ROOT, scan } from './helpers.js';

/**
 * PARITY CANNOT BE ASSERTED WHERE ONLY ONE SIDE IS PRESENT.
 *
 * This file is split into the public `disclosed-extension` repository, which
 * carries `packages/core` and `packages/extension` and NOT the crawler — the
 * crawler travels with the corpus, the letters and the reply ledger, which stay
 * private. The check below reads the crawler's source, so there it has nothing
 * to compare against.
 *
 * `skipIf` rather than a silent conditional: vitest prints a SKIPPED line, so
 * the public repository's test output says out loud that this assertion did not
 * run, and its README says which assertions those are. A parity test that
 * quietly passed because one side was missing would be worse than not shipping
 * it at all.
 */
const CRAWLER_PRESENT = existsSync(join(REPO_ROOT, 'packages', 'crawler', 'src', 'extract.ts'));

describe('the disclosure pattern is the crawler’s, verbatim', () => {
  it.skipIf(!CRAWLER_PRESENT)('matches packages/crawler/src/extract.ts character for character', () => {
    const source = readFileSync(
      join(REPO_ROOT, 'packages', 'crawler', 'src', 'extract.ts'),
      'utf8',
    );
    const block = /export const DISCLOSURE_REGEX_SOURCE =([\s\S]*?);\n/.exec(source);
    expect(block).not.toBeNull();
    // The definition is a concatenation of single-quoted string literals.
    const literals = [...(block?.[1] ?? '').matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((m) => m[1]);
    expect(literals.length).toBeGreaterThan(1);
    expect(literals.join('')).toBe(DISCLOSURE_REGEX_SOURCE);
  });
});

describe('disclosure position — a fact, never a grade', () => {
  const ARTICLE_DISCLOSURE_FIRST = `
    <p>We may earn a commission when you buy through links on our site.</p>
    <h2>1. Sony</h2>
    <a href="https://www.amazon.com/dp/B01?tag=x-20">Buy</a>
  `;
  const ARTICLE_DISCLOSURE_LAST = `
    <h2>1. Sony</h2>
    <a href="https://www.amazon.com/dp/B01?tag=x-20">Buy</a>
    <footer><p>This post contains affiliate links.</p></footer>
  `;

  it('reports a disclosure above the first marked link', () => {
    const doc = page(ARTICLE_DISCLOSURE_FIRST);
    const { report } = scan(doc);
    expect(report.disclosure?.beforeFirstBadgedLink).toBe(true);
    expect(report.disclosure?.inFooter).toBe(false);
    expect(describeDisclosure(report)).toContain('above the first marked link');
  });

  it('reports a disclosure below the first marked link, and that it is in the footer', () => {
    const doc = page(ARTICLE_DISCLOSURE_LAST);
    const { report } = scan(doc);
    expect(report.disclosure?.beforeFirstBadgedLink).toBe(false);
    expect(report.disclosure?.inFooter).toBe(true);
    expect(describeDisclosure(report)).toContain('below the first marked link');
    expect(describeDisclosure(report)).toContain('footer');
  });

  it('says the question does not arise when nothing was marked', () => {
    const doc = page('<p>This post contains affiliate links.</p><a href="/x">x</a>');
    const { report } = scan(doc);
    expect(report.disclosure?.beforeFirstBadgedLink).toBeNull();
    expect(describeDisclosure(report)).toContain('no first marked link');
  });

  it('says so plainly when there is no disclosure text', () => {
    const doc = page('<p>Our favourite headphones.</p>');
    const { report } = scan(doc);
    expect(report.disclosure).toBeNull();
    expect(describeDisclosure(report)).toBe('No disclosure text was detected on this page.');
  });

  it('never claims to be the publisher’s disclosure grade', () => {
    const doc = page(ARTICLE_DISCLOSURE_FIRST);
    const { report } = scan(doc);
    const notes = describePage(report).notes.join(' ');
    expect(notes).toContain('not the publisher’s disclosure grade');
  });

  it('stops after its node budget rather than walking an unbounded document', () => {
    const doc = page(`${'<p>filler</p>'.repeat(50)}<p>We may earn a commission when you buy.</p>`);
    expect(findDisclosure(doc, null, 10)).toBeNull();
    expect(findDisclosure(doc, null)).not.toBeNull();
  });
});

describe('ranked picks — the crawler’s parser, pinned', () => {
  it('parses the listicle shapes the crawler parses', () => {
    expect(parsePickNumber('1. Sony WH-1000XM5')).toBe(1);
    expect(parsePickNumber('#2: Bose QuietComfort')).toBe(2);
    expect(parsePickNumber('3) Apple AirPods Max')).toBe(3);
    expect(parsePickNumber('No. 4 — Sennheiser Momentum')).toBe(4);
    expect(parsePickNumber('  5 – Anker Soundcore')).toBe(5);
  });

  it('rejects years, ranges and bare ordinals (the Class A phantom pick)', () => {
    expect(parsePickNumber('2026 Best Headphones')).toBeNull();
    expect(parsePickNumber('Best Headphones')).toBeNull();
    expect(parsePickNumber('5–8.5 in (13–22 cm) screen')).toBeNull();
    expect(parsePickNumber('7-10 in tablets')).toBeNull();
    expect(parsePickNumber('1.')).toBeNull();
    expect(parsePickNumber('')).toBeNull();
  });

  it('attributes a marked link to the nearest preceding ranked heading', () => {
    const doc = page(`
      <h2>1. Sony WH-1000XM5</h2>
      <a href="https://www.amazon.com/dp/B01?tag=x-20">Buy Sony</a>
      <h2>2. Bose QuietComfort Ultra</h2>
      <a href="https://en.wikipedia.org/wiki/Bose">About Bose</a>
      <h2>3. Apple AirPods Max</h2>
      <a href="https://goto.walmart.com/c/1/2/3">Buy Apple</a>
    `);
    const { report, badged } = scan(doc);
    expect(report.picks.map((p) => p.position)).toEqual([1, 2, 3]);
    expect(report.picks.map((p) => p.badgedLinks)).toEqual([1, 0, 1]);
    expect(report.picksWithBadgedLink).toBe(2);
    expect(collectPicks(doc, badged)).toHaveLength(3);
  });

  it('reports no picks on a page with no ranked headings', () => {
    const doc = page('<h2>Our favourites</h2><a href="https://www.amazon.com/dp/B01?tag=x">Buy</a>');
    const { report } = scan(doc);
    expect(report.picks).toEqual([]);
  });
});

describe('the marker', () => {
  it('states the tier and the network, and no adjective', () => {
    const title = markerTitle({
      tier: 'likely',
      network: 'publisher_cloak',
      merchant: 'Amazon',
      confidence: 0.7,
      evidence: [],
    });
    expect(title).toContain('likely');
    expect(title).toContain('publisher_cloak');
    expect(title).toContain('Amazon');
    expect(title).toContain('classified on your device');
    for (const verdict of ['corrupt', 'shill', 'dishonest', 'biased', 'misleading', 'scam']) {
      expect(title.toLowerCase()).not.toContain(verdict);
    }
  });

  it('keeps its styles inside a shadow root, out of the page', () => {
    const doc = page('');
    const marker = createMarker(doc, {
      tier: 'confirmed',
      network: 'amazon_associates',
      merchant: null,
      confidence: 0.9,
      evidence: [],
    });
    expect(marker.getAttribute(MARKER_ATTRIBUTE)).toBe('confirmed');
    expect(marker.shadowRoot).not.toBeNull();
    expect(marker.shadowRoot?.querySelector('style')).not.toBeNull();
    // Nothing was added to the document's own stylesheets.
    expect(doc.querySelectorAll('style')).toHaveLength(0);
  });
});

describe('the link cap is reported, not hidden', () => {
  it('says the page was not read to the end', () => {
    const doc = page(
      Array.from(
        { length: 30 },
        (_, i) => `<a href="https://example.org/x${i}">link</a>`,
      ).join(''),
    );
    const { report } = scan(doc, { maxLinks: 10 });
    expect(report.capped).toBe(true);
    expect(report.anchorsExamined).toBe(10);
    expect(report.anchorsInDocument).toBe(30);
    expect(describePage(report).notes[0]).toContain('link cap');
  });
});
