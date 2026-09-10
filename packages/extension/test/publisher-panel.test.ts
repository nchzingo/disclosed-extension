/**
 * The publisher panel: five states, five sentences, and no number that the
 * bundle did not carry.
 *
 * SPEC §2.2 is the whole of this file. Below the publication threshold a card
 * is a STATE and never a number, the states are never merged, and the three
 * below-threshold ones assert three different things:
 *
 *   insufficient_data                our sample is too small; more articles would move it
 *   rho_not_computable               every priceable pick carries one rate; ρ is undefined
 *   withheld_unresolved_monetization no affiliate mechanism was established at all
 *
 * plus `not_scored_no_revenue` — the §3 gate, "takes no affiliate revenue" —
 * and the fifth situation, a publisher the bundle has no card for at all,
 * which is "no card" rather than a zero.
 *
 * Every assertion runs against the REAL bundle that ships with the extension.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadBundle, parseBundleCard, type BundleCard } from '../src/lib/bundle.js';
import {
  describePublisher,
  findCard,
  formatPayoutRank,
  STATUS_COPY,
  type PanelState,
} from '../src/lib/cards.js';
import { bundle, REPO_ROOT } from './helpers.js';

const BASE: BundleCard = {
  publisher: 'example.com',
  status: 'insufficient_data',
  headline: 'Insufficient data',
  mBar: 0.5,
  mBarBadgedOnly: 0.5,
  articles: 4,
  medianRho: null,
  ci95: null,
  n: 3,
  publishable: false,
  rateCoverage: 0.5,
  disclosure: { meanDeficiency: 0.25, distribution: { A: 1, B: 3, C: 0, D: 0, F: 0 } },
  gamingFlagCount: 0,
  generatedAt: '2026-09-08T02:20:48.525Z',
  specVersion: 'SPEC: Scoring — v0.6.9',
};

function cardsWith(card: BundleCard): Map<string, BundleCard> {
  return new Map([[card.publisher, card]]);
}

describe('the bundle that ships', () => {
  /**
   * A BUNDLE MAY CARRY NO CARDS, BUT ONLY IF IT SAYS SO IN SO MANY WORDS.
   *
   * The public `disclosed-extension` repository is built by
   * `ops/split-extension.mjs`, which strips the cards while any publisher's
   * seven-day right-of-reply window is still running — a public repository
   * being publication like any other — and writes a note into the artefact
   * saying it did. An empty `cards` array is therefore a legitimate state, and
   * an UNEXPLAINED empty one is a bug: a bundle that lost its cards to a build
   * error would look identical to one that withheld them on purpose.
   *
   * So the assertion is not weakened to "zero or more". It is: either there are
   * cards, or the artefact declares why there are none.
   */
  it('validates, and every card status it carries is one this build can describe', () => {
    if (bundle.cards.size === 0) {
      const raw = JSON.parse(
        readFileSync(join(REPO_ROOT, 'data', 'bundle', 'rules-latest.json'), 'utf8'),
      ) as { notes?: unknown };
      const notes = Array.isArray(raw.notes) ? raw.notes.join('\n') : '';
      expect(
        notes,
        'the bundle carries no cards and does not say why — that is a build failure, not a withholding',
      ).toContain('PUBLISHER CARDS WITHHELD');
    }
    for (const card of bundle.cards.values()) {
      expect(Object.keys(STATUS_COPY)).toContain(card.status);
    }
  });

  it('carries a median ρ only for a publisher over the §2.2 threshold', () => {
    for (const card of bundle.cards.values()) {
      if (!card.publishable) {
        expect(card.medianRho).toBeNull();
        expect(card.ci95).toBeNull();
      }
    }
  });

  it('refuses a bundle whose below-threshold card carries a median', () => {
    // The builder nulls it; this refuses to render one that slipped through.
    // A card that reached a reader with a number it was not entitled to
    // publish would route around SPEC §2.2 entirely.
    expect(() =>
      parseBundleCard({ ...BASE, medianRho: 0.9 }, 'card'),
    ).toThrowError(/publishable/);
    expect(() => loadBundle({ ...{}, cards: [] })).toThrowError(/schemaVersion/);
  });
});

describe('five states, rendered as five different things', () => {
  const states: PanelState[] = [
    'ok',
    'insufficient_data',
    'rho_not_computable',
    'withheld_unresolved_monetization',
    'not_scored_no_revenue',
    'no_card',
  ];

  it('gives every state its own label and its own detail', () => {
    const labels = new Set(states.map((s) => STATUS_COPY[s].label));
    const details = new Set(states.map((s) => STATUS_COPY[s].detail));
    expect(labels.size).toBe(states.length);
    expect(details.size).toBe(states.length);
  });

  it('never shows a number for any below-threshold state', () => {
    for (const status of [
      'insufficient_data',
      'rho_not_computable',
      'withheld_unresolved_monetization',
      'not_scored_no_revenue',
    ]) {
      const card = { ...BASE, status };
      const panel = describePublisher('example.com', cardsWith(card));
      expect(panel.state).toBe(status);
      expect(panel.payoutRank).toBeNull();
    }
  });

  it('does not blame our sample for a fact about the publisher, or the reverse', () => {
    const insufficient = describePublisher(
      'example.com',
      cardsWith({ ...BASE, status: 'insufficient_data' }),
    );
    const notComputable = describePublisher(
      'example.com',
      cardsWith({ ...BASE, status: 'rho_not_computable' }),
    );
    expect(insufficient.detail).not.toEqual(notComputable.detail);
    expect(notComputable.detail).toContain('not a data gap');
    expect(notComputable.detail).toContain('More articles of the same shape would not change');
  });

  it('says "no card" for a publisher the bundle does not carry', () => {
    const panel = describePublisher('some-blog-we-never-crawled.example', bundle.cards);
    expect(panel.state).toBe('no_card');
    expect(panel.payoutRank).toBeNull();
    expect(panel.facts).toEqual([]);
    expect(panel.detail).toContain('We have not measured it');
  });

  it('treats an unknown status as "no card" rather than as one it knows', () => {
    const panel = describePublisher(
      'example.com',
      cardsWith({ ...BASE, status: 'some_future_state' }),
    );
    expect(panel.state).toBe('no_card');
    expect(panel.payoutRank).toBeNull();
  });
});

describe('publishable cards in the bundle', () => {
  const publishable = [...bundle.cards.values()].filter((c) => c.publishable);

  it('THERE ARE NONE, and that is the measured state of this corpus', () => {
    // This test read `expect(publishable.length).toBeGreaterThan(0)` until
    // 2026-09-08b. nymag.com was the one publisher over the SPEC §2.2
    // threshold of 20 qualifying articles, at 26. Correcting pick ownership
    // (docs/EXTRACTION.md §9/§9.2) moved it to 17 — not by removing articles
    // but by removing FALSE ZEROS: picks we had wrongly read as unmonetized
    // were entering ρ at r_i = 0 under SPEC §0.1 and supplying the rate
    // variance those articles qualified on.
    //
    // The assertion is inverted rather than deleted, because "no card in this
    // bundle may print a median ρ" is a stronger guard than the one it
    // replaces, and it is the guard that matches the data.
    expect(publishable).toEqual([]);
    for (const card of bundle.cards.values()) {
      expect(describePublisher(card.publisher, bundle.cards).payoutRank, card.publisher).toBeNull();
    }
  });

  it('still prints median, interval and n TOGETHER whenever a card becomes publishable', () => {
    // SPEC §3: never a bare number. Driven against a synthetic publishable
    // card so the formatting contract keeps being tested while the corpus
    // holds none.
    const cards = cardsWith({
      ...BASE,
      publishable: true,
      status: 'ok',
      headline: 'Payout–Rank correlation',
      medianRho: -0.31,
      ci95: [-0.52, -0.08],
      n: 21,
    });
    const panel = describePublisher(BASE.publisher, cards);
    expect(panel.state).toBe('ok');
    expect(panel.payoutRank).not.toBeNull();
    const line = formatPayoutRank(panel.payoutRank!);
    expect(line).toContain('median ρ');
    expect(line).toContain('95% CI');
    expect(line).toContain('n = ');
    expect(panel.facts.map((f) => f.label)).toContain('Monetized (M̄)');
    expect(panel.facts.map((f) => f.label)).toContain('Disclosure grades');
  });
});

describe('matching a page host to a card', () => {
  it('matches exactly, through www., and by registrable domain — and says which', () => {
    const cards = cardsWith({ ...BASE, publisher: 'nymag.com' });
    expect(findCard('nymag.com', cards).match).toBe('exact');
    expect(findCard('www.nymag.com', cards).match).toBe('www_stripped');
    expect(findCard('shop.nymag.com', cards).match).toBe('registrable_domain');
    expect(findCard('nymag.com.evil.example', cards).card).toBeNull();
  });

  it('names the publisher the card was published for, not the host it matched', () => {
    const panel = describePublisher('shop.nymag.com', cardsWith({ ...BASE, publisher: 'nymag.com' }));
    expect(panel.cardPublisher).toBe('nymag.com');
    expect(panel.host).toBe('shop.nymag.com');
    expect(panel.match).toBe('registrable_domain');
  });
});
