/**
 * SPEC-scoring.md §0.1.1 — banded rates. Tests before implementation.
 *
 * Six of the ten direct-program merchants in the corpus publish a RANGE
 * rather than a point rate. §0.1.1 resolves r_i to the PUBLISHED MINIMUM —
 * the floor the publisher provably earns — and requires every rho_a to be
 * computed twice so the choice of floor is auditable rather than assumed.
 */
import { describe, expect, it } from 'vitest';
import {
  articleRho,
  articleRhoAtRateMax,
  bandSensitivity,
  computeArticleMetrics,
  effectiveRate,
  effectiveRateMax,
  BAND_SENSITIVITY_SPREAD,
} from '../src/index.js';
import type { ScoredPick } from '../src/index.js';

const pick = (position: number, rate: number | null, rateMax?: number | null, monetized = true): ScoredPick => ({
  position,
  rate,
  monetized,
  ...(rateMax === undefined ? {} : { rateMax }),
});

describe('§0.1.1 — r_i is the published MINIMUM', () => {
  it('uses rate (the floor) as r_i, not a midpoint', () => {
    // Roborock publishes 4-7%. r_i is 0.04. A midpoint of 0.055 is a number
    // no source states.
    expect(effectiveRate(pick(1, 0.04, 0.07))).toBe(0.04);
  });

  it('exposes the ceiling separately for the sensitivity pass', () => {
    expect(effectiveRateMax(pick(1, 0.04, 0.07))).toBe(0.07);
  });

  it('treats a point rate as a degenerate band', () => {
    // Dreame publishes a flat 6%. min == max, so it can never be sensitive.
    expect(effectiveRate(pick(1, 0.06))).toBe(0.06);
    expect(effectiveRateMax(pick(1, 0.06))).toBe(0.06);
  });

  it('keeps an unmonetized pick at r = 0 in BOTH passes (§0.1)', () => {
    const p = pick(1, null, null, false);
    expect(effectiveRate(p)).toBe(0);
    expect(effectiveRateMax(p)).toBe(0);
  });

  it('keeps a private rate null in BOTH passes', () => {
    const p = pick(1, null, null, true);
    expect(effectiveRate(p)).toBeNull();
    expect(effectiveRateMax(p)).toBeNull();
  });
});

describe('§0.1.1 validation', () => {
  it('throws when rateMax is below rate — that is not a band', () => {
    expect(() => articleRho([pick(1, 0.07, 0.04), pick(2, 0.02)])).toThrow(/rateMax/i);
  });

  it('throws when rateMax is outside [0, 1]', () => {
    expect(() => articleRho([pick(1, 0.04, 1.5), pick(2, 0.02)])).toThrow(/rateMax/i);
  });

  it('throws when an unmonetized pick carries a positive rateMax', () => {
    expect(() => articleRho([pick(1, 0, 0.05, false), pick(2, 0.02)])).toThrow(/unmonetized/i);
  });

  it('accepts rateMax null alongside a null rate', () => {
    expect(() => articleRho([pick(1, null, null), pick(2, 0.02), pick(3, 0.03)])).not.toThrow();
  });
});

describe('§0.1.1 sensitivity — every rho computed twice', () => {
  it('reports both values and no flag when the band does not move rho', () => {
    // Ranks agree at both ends: rho is identical.
    const picks = [pick(1, 0.08, 0.2), pick(2, 0.04, 0.07), pick(3, 0.01, 0.02)];
    const s = bandSensitivity(picks);
    expect(s.rhoAtRateMin).toBe(articleRho(picks));
    expect(s.rhoAtRateMax).toBe(articleRhoAtRateMax(picks));
    expect(s.rhoAtRateMin).toBeCloseTo(1, 10);
    expect(s.rhoAtRateMax).toBeCloseTo(1, 10);
    expect(s.bandSensitive).toBe(false);
    expect(s.bandedPickCount).toBe(3);
  });

  it('FLAGS band_sensitive when the ordering inverts between floor and ceiling', () => {
    // The top pick sits on a WIDE band and the bottom pick on a narrow one.
    // At the floor the article looks exculpatory (rho = -1: the publisher
    // ranks its lowest-paying product first); at the ceiling it looks
    // suspicious. That is exactly the case a single number would hide.
    const picks = [pick(1, 0.01, 0.95), pick(2, 0.05, 0.5), pick(3, 0.9, 0.91)];
    const s = bandSensitivity(picks);
    expect(Math.sign(s.rhoAtRateMin!)).not.toBe(Math.sign(s.rhoAtRateMax!));
    expect(s.signFlip).toBe(true);
    expect(s.bandSensitive).toBe(true);
  });

  it(`FLAGS band_sensitive when the spread exceeds ${BAND_SENSITIVITY_SPREAD}`, () => {
    const picks = [pick(1, 0.02, 0.9), pick(2, 0.03, 0.5), pick(3, 0.04, 0.1)];
    const s = bandSensitivity(picks);
    expect(Math.abs(s.rhoAtRateMin! - s.rhoAtRateMax!)).toBeGreaterThan(BAND_SENSITIVITY_SPREAD);
    expect(s.bandSensitive).toBe(true);
  });

  it('never flags an article with no banded picks', () => {
    const picks = [pick(1, 0.08), pick(2, 0.04), pick(3, 0.01)];
    const s = bandSensitivity(picks);
    expect(s.bandedPickCount).toBe(0);
    expect(s.bandSensitive).toBe(false);
    expect(s.rhoAtRateMin).toBe(s.rhoAtRateMax);
  });

  it('returns nulls, not a throw, when rho is undefined at either end', () => {
    // One priced pick: no ordering to correlate.
    const s = bandSensitivity([pick(1, 0.04, 0.07)]);
    expect(s.rhoAtRateMin).toBeNull();
    expect(s.rhoAtRateMax).toBeNull();
    expect(s.bandSensitive).toBe(false);
  });
});

describe('§0.1.1 — the distribution uses the rate_min value', () => {
  it('computeArticleMetrics reports rho at the floor as THE rho', () => {
    const picks = [pick(1, 0.02, 0.9), pick(2, 0.03, 0.5), pick(3, 0.04, 0.1), pick(4, 0.05, 0.05)];
    const m = computeArticleMetrics({ id: 'a', picks, disclosureGrade: 'A' });
    // §0.1.1: band_sensitive articles enter the §2 distribution at rate_min.
    expect(m.rho).toBe(articleRho(picks));
    expect(m.rhoAtRateMax).toBe(articleRhoAtRateMax(picks));
    expect(m.bandSensitive).toBe(true);
    expect(m.bandedPickCount).toBe(3);
  });

  it('carries bandSensitive false and equal rhos for an unbanded article', () => {
    const picks = [pick(1, 0.08), pick(2, 0.04), pick(3, 0.02), pick(4, 0.01)];
    const m = computeArticleMetrics({ id: 'a', picks, disclosureGrade: 'A' });
    expect(m.bandSensitive).toBe(false);
    expect(m.rho).toBe(m.rhoAtRateMax);
  });
});

describe('§0.1.2 — a multi-merchant pick is its own case, not a band', () => {
  const multi = (position: number, rate: number, rateMax: number | null, merchants: string[]): ScoredPick => ({
    position,
    rate,
    rateMax,
    monetized: true,
    multiMerchant: true,
    merchants,
  });

  it('r_i is the MINIMUM across the pick’s merchants', () => {
    // BGR pick 1 reaches amazon.com (3.0%) and dreametech.com (6.0%). The
    // floor is what the publisher provably earns whichever link is taken.
    const p = multi(1, 0.03, 0.06, ['amazon.com', 'dreametech.com']);
    expect(effectiveRate(p)).toBe(0.03);
    expect(effectiveRateMax(p)).toBe(0.06);
  });

  it('carries the merchant list so the minimum is recomputable', () => {
    const p = multi(1, 0.03, 0.06, ['amazon.com', 'dreametech.com']);
    expect(p.merchants).toEqual(['amazon.com', 'dreametech.com']);
  });

  it('is NOT counted as a band — different unknowns are counted separately', () => {
    const picks = [
      multi(1, 0.03, 0.06, ['amazon.com', 'dreametech.com']),
      pick(2, 0.04, 0.07), // a genuine §0.1.1 band
      pick(3, 0.02),
    ];
    const s = bandSensitivity(picks);
    expect(s.bandedPickCount).toBe(1);
    expect(s.multiMerchantPickCount).toBe(1);
  });

  it('contributes to band_sensitivity exactly as a band does', () => {
    // Same shape as the §0.1.1 sign-flip case, but driven by merchant
    // ambiguity rather than by one merchant's published range.
    const picks = [
      multi(1, 0.01, 0.95, ['a.example', 'b.example']),
      multi(2, 0.05, 0.5, ['a.example', 'c.example']),
      multi(3, 0.9, 0.91, ['a.example', 'd.example']),
    ];
    const s = bandSensitivity(picks);
    expect(s.signFlip).toBe(true);
    expect(s.bandSensitive).toBe(true);
    expect(s.multiMerchantPickCount).toBe(3);
    expect(s.bandedPickCount).toBe(0);
  });

  it('a single-merchant pick with a spread is still a band, not multi-merchant', () => {
    const s = bandSensitivity([pick(1, 0.04, 0.07), pick(2, 0.02), pick(3, 0.01)]);
    expect(s.bandedPickCount).toBe(1);
    expect(s.multiMerchantPickCount).toBe(0);
  });

  it('handles a multi-merchant pick whose merchants happen to agree on rate', () => {
    const p = multi(1, 0.03, null, ['amazon.com', 'other.example']);
    expect(effectiveRate(p)).toBe(0.03);
    expect(effectiveRateMax(p)).toBe(0.03);
    const s = bandSensitivity([p, pick(2, 0.02), pick(3, 0.01)]);
    expect(s.multiMerchantPickCount).toBe(1);
    expect(s.bandSensitive).toBe(false);
  });

  it('throws when multiMerchant is claimed with fewer than two merchants', () => {
    const bad: ScoredPick = { position: 1, rate: 0.03, monetized: true, multiMerchant: true, merchants: ['only.example'] };
    expect(() => articleRho([bad, pick(2, 0.02)])).toThrow(/multiMerchant/i);
  });

  it('surfaces both counts on ArticleMetrics', () => {
    const picks = [
      multi(1, 0.03, 0.06, ['amazon.com', 'dreametech.com']),
      pick(2, 0.04, 0.07),
      pick(3, 0.02),
      pick(4, 0.01),
    ];
    const m = computeArticleMetrics({ id: 'a', picks, disclosureGrade: 'A' });
    expect(m.bandedPickCount).toBe(1);
    expect(m.multiMerchantPickCount).toBe(1);
  });
});
