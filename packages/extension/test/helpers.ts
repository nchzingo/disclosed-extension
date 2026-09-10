/**
 * Test helpers. Every test runs against the REAL rules bundle
 * (`data/bundle/rules-latest.json`) — the same bytes the extension ships —
 * because a test against a hand-written toy ruleset would prove things about
 * the toy.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { getBundle } from '../src/lib/bundle.js';
import { insertMarker } from '../src/lib/marker.js';
import { buildPrefilter, type Prefilter } from '../src/lib/prefilter.js';
import { Scanner, type PageReport, type ScannerOptions } from '../src/lib/scan.js';

const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(here, '..', '..', '..');

export const bundle = getBundle();
export const ruleset = bundle.ruleset;
export const prefilter: Prefilter = buildPrefilter(ruleset);

/** A document with a real page URL — the declaration rule needs one. */
export function page(html: string, url = 'https://example.com/best-headphones'): Document {
  return new JSDOM(`<!doctype html><html><body>${html}</body></html>`, { url }).window.document;
}

export interface ScanResult {
  scanner: Scanner;
  report: PageReport;
  /** Anchors handed to the badge callback, in order. */
  badged: HTMLAnchorElement[];
}

export function scan(doc: Document, opts: Partial<ScannerOptions> = {}): ScanResult {
  const badged: HTMLAnchorElement[] = [];
  // Records the badge AND does what production does — inserts the marker —
  // unless a test supplies its own handler.
  const onBadge = opts.onBadge ?? ((a: HTMLAnchorElement, c) => void insertMarker(a, c));
  const scanner = new Scanner(doc, {
    ruleset,
    prefilter,
    ...opts,
    onBadge: (anchor, c) => {
      badged.push(anchor);
      onBadge(anchor, c);
    },
  });
  scanner.scan();
  return { scanner, report: scanner.report(), badged };
}

export interface FixtureLink {
  href: string;
  rel: string | null;
  sourceUrl: string | null;
}

/** The deterministic corpus sample. See tools/build-corpus-fixture.mjs. */
export function corpusSample(): {
  links: FixtureLink[];
  /**
   * Every cloaked, unbadged URL in the corpus — the only shape that ever made
   * this extension reach for the network. Both strata are COMPLETE, not
   * sampled: the corpus holds 60 the shipped resolution table can answer and
   * 10 it cannot, and the fixture carries all 70.
   */
  cloaks: FixtureLink[];
  bundleSha256: string;
} {
  const raw = JSON.parse(
    readFileSync(join(here, 'fixtures', 'corpus-sample.json'), 'utf8'),
  ) as { links: FixtureLink[]; cloaks: FixtureLink[]; bundleSha256: string };
  return raw;
}
