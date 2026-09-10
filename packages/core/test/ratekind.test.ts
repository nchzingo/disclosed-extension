/**
 * SPEC §0.1.3 — `rate_kind`, v0.6.10, 2026-09-08.
 *
 * A rate is not a number, it is a number in a unit. Spearman will happily rank
 * a $40 bounty against a 6% share and return a coefficient for it, and nothing
 * in the pipeline before this would have stopped it.
 *
 * The tests are in three groups, and the first one is the one that has to hold
 * for the amendment to be legitimate at all:
 *
 *  1. **It is a NO-OP on the corpus that exists.** Every rate this project
 *     holds today is a percentage of sale, so every article's dominant kind is
 *     `percent_of_sale`, nothing mismatches, and every ρ is what v0.6.9
 *     produced. The rule was written before the data that will exercise it.
 *  2. What it does when a second kind appears.
 *  3. What it refuses: a bounty with no currency, a currency on a percentage,
 *     an `other` carrying a number.
 */
import { describe, expect, it } from 'vitest';
import {
  articleRho,
  articleRhoAtRateMax,
  computeArticleMetrics,
  dominantRateKind,
  effectiveRate,
  effectiveRateInKind,
  rateCoverage,
  rateKindKey,
  rateKindMismatchCount,
  DEFAULT_RATE_KIND,
  RATE_KINDS,
  type ScoredPick,
} from '../src/index.js';

const pct = (position: number, rate: number | null, over: Partial<ScoredPick> = {}): ScoredPick => ({
  position,
  rate,
  monetized: rate !== null,
  ...over,
});

const bounty = (position: number, amount: number, currency = 'USD'): ScoredPick => ({
  position,
  rate: amount,
  monetized: true,
  rateKind: 'flat_bounty',
  rateCurrency: currency,
});

// ---------------------------------------------------------------------------
// 1. A no-op on percent-only data
// ---------------------------------------------------------------------------

describe('on the corpus that exists — every rate a percentage of sale', () => {
  const picks = [pct(1, 0.08), pct(2, 0.04), pct(3, null, { monetized: false, rate: 0 }), pct(4, 0.06)];

  it('defaults an unlabelled pick to percent_of_sale, which is what they all were', () => {
    expect(DEFAULT_RATE_KIND).toBe('percent_of_sale');
    expect(rateKindKey(pct(1, 0.05))).toBe('percent_of_sale');
    expect(RATE_KINDS.size).toBe(4);
  });

  it('finds one dominant kind and no mismatch', () => {
    expect(dominantRateKind(picks)).toEqual({
      kind: 'percent_of_sale',
      currency: null,
      key: 'percent_of_sale',
      count: 3,
    });
    expect(rateKindMismatchCount(picks)).toBe(0);
  });

  it('leaves r_i, ρ and coverage exactly where v0.6.9 left them', () => {
    const dominant = dominantRateKind(picks);
    for (const p of picks) expect(effectiveRateInKind(p, dominant)).toBe(effectiveRate(p));
    expect(articleRho(picks)).toBeCloseTo(0.4, 10);
    expect(rateCoverage(picks)).toBe(1);
  });

  it('is inert on an article that prices nothing at all', () => {
    const unpriced = [pct(1, null, { monetized: true }), pct(2, null, { monetized: false, rate: 0 })];
    expect(dominantRateKind(unpriced)).toBeNull();
    expect(rateKindMismatchCount(unpriced)).toBe(0);
    // The unmonetized pick still enters at 0 — §0.1, untouched.
    expect(effectiveRateInKind(unpriced[1]!, null)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 2. What it does when a second kind appears
// ---------------------------------------------------------------------------

describe('when a second kind appears', () => {
  // Three percentages and one bounty: a VPN roundup where one merchant pays a
  // flat $40 and the rest pay a share. This is the shape the next corpus
  // expansion is expected to produce.
  const mixed = [pct(1, 0.4), bounty(2, 40), pct(3, 0.25), pct(4, 0.3)];

  it('takes the plurality kind and drops the other from ρ', () => {
    expect(dominantRateKind(mixed)?.kind).toBe('percent_of_sale');
    expect(rateKindMismatchCount(mixed)).toBe(1);
    const dominant = dominantRateKind(mixed);
    expect(effectiveRateInKind(mixed[1]!, dominant)).toBeNull();
    // …and `effectiveRate` still answers what the pick pays. The two questions
    // are different and only one of them is unit-blind.
    expect(effectiveRate(mixed[1]!)).toBe(40);
  });

  it('computes ρ over the three comparable picks and NOT over four', () => {
    // s_i = 5 - p_i over the full article length: 4, 2, 1 against .40 .25 .30
    expect(articleRho(mixed)).toBeCloseTo(0.5, 10);
    // The same three, stated as their own article, must agree — the mismatched
    // pick is excluded, not reweighted.
    const n = mixed.length;
    const same = [pct(1, 0.4), pct(3, 0.25), pct(4, 0.3), pct(2, null, { monetized: true })];
    expect(same.length).toBe(n);
    expect(articleRho(same)).toBeCloseTo(articleRho(mixed)!, 10);
  });

  it('drops coverage, because a rate we cannot use is not coverage', () => {
    // 4 monetized, 3 usable.
    expect(rateCoverage(mixed)).toBeCloseTo(0.75, 10);
    // M̄ is untouched: the publisher IS paid on the bounty pick.
    expect(computeArticleMetrics({ id: 'a', picks: mixed, disclosureGrade: 'A' }).monetizedRatio).toBe(1);
  });

  it('publishes the dominant kind and the mismatch count on the article', () => {
    const m = computeArticleMetrics({ id: 'a', picks: mixed, disclosureGrade: 'A' });
    expect(m.dominantRateKind).toBe('percent_of_sale');
    expect(m.dominantRateCurrency).toBeNull();
    expect(m.rateKindMismatchCount).toBe(1);
    expect(m.kPricedPicks).toBe(3);
    expect(m.ratedPairs.map(([, r]) => r)).toEqual([0.4, 0.25, 0.3]);
  });

  it('separates two bounties by CURRENCY — USD 40 and CAD 40 are different', () => {
    const picks = [bounty(1, 40, 'USD'), bounty(2, 50, 'USD'), bounty(3, 40, 'CAD')];
    const dominant = dominantRateKind(picks);
    expect(dominant?.kind).toBe('flat_bounty');
    expect(dominant?.currency).toBe('USD');
    expect(dominant?.key).toBe('flat_bounty|USD');
    expect(rateKindMismatchCount(picks)).toBe(1);
  });

  it('does NOT separate two percentages by anything', () => {
    const picks = [pct(1, 0.4), pct(2, 0.2, { rateKind: 'percent_of_sale' })];
    expect(rateKindMismatchCount(picks)).toBe(0);
  });

  it('treats recurring_percent as its own kind, not as a percentage', () => {
    const picks = [
      pct(1, 0.4, { rateKind: 'recurring_percent' }),
      pct(2, 0.3, { rateKind: 'recurring_percent' }),
      pct(3, 0.1),
    ];
    expect(dominantRateKind(picks)?.kind).toBe('recurring_percent');
    expect(rateKindMismatchCount(picks)).toBe(1);
  });

  it('breaks a TIE by the highest-ranked priced pick, and says which won', () => {
    // 2 v 2. Position 1 is a bounty, so the bounties take it.
    const tie = [bounty(1, 40), pct(2, 0.3), bounty(3, 50), pct(4, 0.2)];
    expect(dominantRateKind(tie)?.kind).toBe('flat_bounty');
    // Reverse the ranks and the answer reverses with them. No fixed
    // preference order between kinds exists.
    const flipped = [pct(1, 0.3), bounty(2, 40), pct(3, 0.2), bounty(4, 50)];
    expect(dominantRateKind(flipped)?.kind).toBe('percent_of_sale');
  });

  it('keeps an UNMONETIZED pick at r_i = 0 whatever the dominant kind is', () => {
    // Zero is zero in every unit, so nothing is compared across units — and
    // dropping "the publisher earns nothing on its top pick" is the one bias
    // §0.1 excludes structurally.
    const picks = [pct(1, null, { monetized: false, rate: 0 }), bounty(2, 40), bounty(3, 20)];
    const dominant = dominantRateKind(picks);
    expect(dominant?.kind).toBe('flat_bounty');
    expect(effectiveRateInKind(picks[0]!, dominant)).toBe(0);
    expect(articleRho(picks)).not.toBeNull();
  });

  it('applies a band WITHIN a kind — a bounty band is a band (§0.1.1)', () => {
    const picks = [
      { position: 1, rate: 30, rateMax: 60, monetized: true, rateKind: 'flat_bounty' as const, rateCurrency: 'USD' },
      bounty(2, 40),
      bounty(3, 50),
    ];
    // Floor 30/40/50 against prominence 3/2/1 — perfectly inverted.
    expect(articleRho(picks)).toBeCloseTo(-1, 10);
    // Ceiling 60/40/50 against 3/2/1 — the sign flips, which is the whole
    // point of the sensitivity pass, and it runs on amounts exactly as it
    // runs on percentages.
    expect(articleRhoAtRateMax(picks)).toBeCloseTo(0.5, 10);
    const m = computeArticleMetrics({ id: 'a', picks, disclosureGrade: 'A' });
    expect(m.bandSensitive).toBe(true);
  });

  it('returns null ρ when only one pick survives the kind filter', () => {
    // Not a coefficient over one point, and not a coefficient over two units.
    expect(articleRho([pct(1, 0.4), bounty(2, 40)])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. What it refuses
// ---------------------------------------------------------------------------

describe('what a rate in a unit refuses to be', () => {
  const metrics = (picks: ScoredPick[]) =>
    computeArticleMetrics({ id: 'a', picks, disclosureGrade: 'A' });

  it('refuses a flat_bounty with no currency', () => {
    expect(() =>
      metrics([{ position: 1, rate: 40, monetized: true, rateKind: 'flat_bounty' }]),
    ).toThrow(/must carry a currency/);
    expect(() =>
      metrics([{ position: 1, rate: 40, monetized: true, rateKind: 'flat_bounty', rateCurrency: '  ' }]),
    ).toThrow(/must carry a currency/);
  });

  it('refuses a currency on a percentage — a percentage is dimensionless', () => {
    expect(() => metrics([{ position: 1, rate: 0.4, monetized: true, rateCurrency: 'USD' }])).toThrow(
      /only meaningful on a flat_bounty/,
    );
  });

  it('refuses a number on rateKind "other"', () => {
    expect(() =>
      metrics([{ position: 1, rate: 0.4, monetized: true, rateKind: 'other' }]),
    ).toThrow(/must \n?be null|must be null/);
  });

  it('refuses an unknown kind', () => {
    expect(() =>
      metrics([{ position: 1, rate: 0.4, monetized: true, rateKind: 'per_click' as never }]),
    ).toThrow(/unknown rateKind/);
  });

  it('still holds a percentage to [0, 1], and does NOT hold a bounty to it', () => {
    expect(() => metrics([pct(1, 1.5)])).toThrow(/decimal in \[0, 1\]/);
    expect(() => metrics([bounty(1, 40)])).not.toThrow();
    expect(() => metrics([bounty(1, -1)])).toThrow(/decimal in \[0, 1\]/);
  });

  it('still refuses a positive rate on an unmonetized pick, in any unit', () => {
    expect(() =>
      metrics([{ position: 1, rate: 40, monetized: false, rateKind: 'flat_bounty', rateCurrency: 'USD' }]),
    ).toThrow(/must have rate null or 0/);
  });
});
