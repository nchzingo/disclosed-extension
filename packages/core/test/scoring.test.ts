/**
 * Scoring math — SPEC-scoring.md v0.6 §0–§1 metrics and §3 report card.
 * (Distribution, bootstrap CI, gaming flag, SPP inference live in
 * inference.test.ts, including the §2.4 falsification record.)
 *
 * Every expected value was computed by hand from the published formulas.
 *
 * v0.6 exercised here: article `id` (§0.2) is required, opaque, and unique —
 * an empty id or a duplicate id throws instead of mis-keying the corpus.
 */
import { describe, expect, it } from 'vitest';
import {
  articleRho,
  computeArticleMetrics,
  computeKickbackScore,
  effectiveRate,
  formatPayoutRankHeadline,
  DISCLOSURE_DEFICIENCY,
  KICKBACK_WEIGHTS,
  MIN_PRICED_PICKS,
  MIN_QUALIFYING_ARTICLES,
  MIN_RATED_PICKS,
  MIN_RATE_COVERAGE,
  monetizedRatio,
  rateCoverage,
  scorePublisher,
  spearman,
  topPickPremium,
  POOLED_RHO_WARNING,
  type PayoutRankDistribution,
  type ScoredPick,
} from '../src/index.js';
import {
  article,
  honestArticle,
  many,
  monotoneArticle,
  picks,
  soloArticle,
  suspiciousArticle,
} from './helpers.js';

describe('§0.1 effectiveRate — the load-bearing r_i derivation', () => {
  it('is 0 for an unmonetized pick (a known rate, not missing)', () => {
    expect(effectiveRate({ position: 1, rate: null, monetized: false })).toBe(0);
    expect(effectiveRate({ position: 1, rate: 0, monetized: false })).toBe(0);
  });

  it('is the published rate for a monetized pick', () => {
    expect(effectiveRate({ position: 1, rate: 0.08, monetized: true })).toBe(0.08);
  });

  it('is null only when a monetized pick has a private rate', () => {
    expect(effectiveRate({ position: 1, rate: null, monetized: true })).toBeNull();
  });
});

describe('§0.2 article identity', () => {
  it('rejects a missing or empty id', () => {
    expect(() =>
      computeArticleMetrics({ id: '', picks: picks([0.1, 0.05]), disclosureGrade: 'A' }),
    ).toThrow(/id/);
    expect(() =>
      computeArticleMetrics({
        // @ts-expect-error — runtime guard for untyped callers
        id: undefined,
        picks: picks([0.1, 0.05]),
        disclosureGrade: 'A',
      }),
    ).toThrow(/id/);
  });

  it('rejects duplicate ids across a publisher corpus (corpus primary key)', () => {
    expect(() => scorePublisher([suspiciousArticle('same'), honestArticle('same')])).toThrow(
      /duplicate/,
    );
  });

  it('carries the id into ArticleMetrics', () => {
    expect(computeArticleMetrics(suspiciousArticle('abc123')).id).toBe('abc123');
  });
});

describe('§1.1 monetized ratio', () => {
  it('is the monetized fraction of all picks', () => {
    expect(
      monetizedRatio(picks([0.1, 0.1, 0.1, null, null], [true, true, true, false, false])),
    ).toBe(0.6);
  });

  it('is null for an empty article', () => {
    expect(monetizedRatio([])).toBeNull();
  });
});

describe('§1.2 rate coverage — C_a = k_a / monetized', () => {
  it('divides priced picks by monetized picks', () => {
    const p = picks([0.1, 0.08, 0.05, null, null], [true, true, true, true, false]);
    expect(rateCoverage(p)).toBe(0.75);
  });

  it('is bounded [0,1]: unmonetized picks never enter the numerator', () => {
    const p = picks([0.1, 0.08, null, null, null], [true, true, false, false, false]);
    expect(rateCoverage(p)).toBe(1);
  });

  it('is null when nothing is monetized (denominator is zero)', () => {
    expect(rateCoverage(picks([null, null], [false, false]))).toBeNull();
  });
});

describe('§1.3 top-pick premium', () => {
  it('reports premium in percentage points plus the percentile of the #1 pick', () => {
    const result = topPickPremium(picks([0.1, 0.08, 0.05, 0.03]));
    expect(result!.premiumPoints).toBeCloseTo(3.5, 10);
    expect(result!.percentile).toBeCloseTo(0.875, 10);
  });

  it('counts unmonetized picks at rate 0 in the median set', () => {
    const result = topPickPremium(picks([0.1, null, null, null], [true, false, false, false]));
    expect(result!.premiumPoints).toBeCloseTo(10, 10);
    expect(result!.percentile).toBeCloseTo(0.875, 10);
  });

  it('is null when the #1 pick is monetized with an unknown rate', () => {
    expect(topPickPremium(picks([null, 0.08, 0.05, 0.03], [true, true, true, true]))).toBeNull();
  });
});

describe('§1.4 article Spearman with r_i = 0 for unmonetized picks', () => {
  it('is +1 when rates fall with position (top pays most)', () => {
    expect(articleRho(picks([0.1, 0.08, 0.05, 0.03, 0.01]))).toBeCloseTo(1, 10);
  });

  it('is -1 when rates rise with position (exculpatory)', () => {
    expect(articleRho(picks([0.01, 0.03, 0.05, 0.08, 0.1]))).toBeCloseTo(-1, 10);
  });

  it('CORRECTNESS: including zero-earning picks pulls ρ down from the drop-them value', () => {
    const p = picks([0.1, null, 0.05, null, 0.01], [true, false, true, false, true]);
    expect(articleRho(p)).toBeCloseTo(4 / Math.sqrt(95), 10);
  });

  it('the ρ = ±0.9 fixtures compute as designed', () => {
    expect(articleRho(suspiciousArticle('a').picks)).toBeCloseTo(0.9, 10);
    expect(articleRho(honestArticle('b').picks)).toBeCloseTo(-0.9, 10);
  });

  it('is null when all determined rates are identical', () => {
    expect(articleRho(picks([0.05, 0.05, 0.05, 0.05, 0.05]))).toBeNull();
    expect(articleRho(picks([null, null, null, null], [false, false, false, false]))).toBeNull();
  });

  it('spearman is exposed and returns null on degenerate input', () => {
    expect(spearman([1, 2, 3], [5, 5, 5])).toBeNull();
    expect(spearman([1, 2, 3, 4], [10, 20, 25, 40])).toBeCloseTo(1, 10);
  });
});

describe('§1.4 pool inclusion criteria (hard, all three)', () => {
  it('requires k_a >= 2 priced picks; k_a = 1 routes to SPP', () => {
    expect(MIN_PRICED_PICKS).toBe(2);
    const m = computeArticleMetrics(soloArticle('a', 5, 2));
    expect(m.kPricedPicks).toBe(1);
    expect(m.solePaidPosition).toBe(2);
    expect(m.qualifiesForPool).toBe(false);
    expect(m.exclusionReasons).toEqual(['fewer_than_2_priced_picks']);
  });

  it('requires >= 4 picks with a determined rate', () => {
    const m = computeArticleMetrics(article('a', [0.1, 0.08, 0.05]));
    expect(m.nRatedPicks).toBe(3);
    expect(m.exclusionReasons).toContain('fewer_than_4_rated_picks');
    expect(MIN_RATED_PICKS).toBe(4);
  });

  it('requires rate coverage >= 0.60', () => {
    const m = computeArticleMetrics(
      article('a', [0.1, 0.08, 0.05, 0.03, null, null, null, null, null, null]),
    );
    expect(m.rateCoverage).toBeCloseTo(0.4, 10);
    expect(m.exclusionReasons).toContain('rate_coverage_below_threshold');
    expect(MIN_RATE_COVERAGE).toBe(0.6);
  });

  it('excludes an undefined correlation even when n, k, and coverage pass', () => {
    const m = computeArticleMetrics(article('a', [0.05, 0.05, 0.05, 0.05, 0.05]));
    expect(m.rho).toBeNull();
    expect(m.exclusionReasons).toContain('rho_undefined');
  });

  it('a qualifying article has no exclusion reasons', () => {
    const m = computeArticleMetrics(suspiciousArticle('a'));
    expect(m.qualifiesForPool).toBe(true);
    expect(m.exclusionReasons).toEqual([]);
  });
});

describe('§1.5 disclosure grades', () => {
  it('maps grades to the published deficiency values', () => {
    expect(DISCLOSURE_DEFICIENCY).toEqual({ A: 0, B: 0.25, C: 0.5, D: 0.75, F: 1 });
  });
});

describe('§2.1 headline formatting', () => {
  const dist: PayoutRankDistribution = {
    median: 0.9012,
    q1: 0.8546,
    q3: 0.9377,
    ci95: [0.8722, 0.9241],
    lowHeterogeneity: false,
    qualifyingArticles: 21,
    publishable: true,
  };

  it('formats the §2.1 statement: median, IQR, n, coverage', () => {
    expect(formatPayoutRankHeadline(dist, 0.7412)).toBe(
      'median ρ = 0.90, IQR [0.85, 0.94], n = 21 articles, rate coverage 74%',
    );
  });

  it('refuses to state a number below the publication threshold', () => {
    const small = { ...dist, qualifyingArticles: 5, publishable: false };
    expect(formatPayoutRankHeadline(small, 0.7412)).toBe(
      'insufficient data (n = 5 qualifying articles; minimum 20)',
    );
    expect(MIN_QUALIFYING_ARTICLES).toBe(20);
  });
});

describe('§3 Kickback Score — R is the distribution median, never the pooled scalar', () => {
  it('publishes the two-term weights, versioned', () => {
    expect(KICKBACK_WEIGHTS).toEqual({ R: 0.75, O: 0.25 });
  });

  it('renormalizes to K = 100 × R when O is null (§4)', () => {
    const k = computeKickbackScore({ medianRho: 0.5 });
    expect(k.score).toBeCloseTo(50, 10);
    expect(k.effectiveWeights).toEqual({ R: 1, O: null });
  });

  it('uses both terms when O is supplied', () => {
    const k = computeKickbackScore({ medianRho: 0.5, omissionIndex: 0.3 });
    expect(k.score).toBeCloseTo(45, 10);
    expect(k.effectiveWeights).toEqual({ R: 0.75, O: 0.25 });
  });

  it('clamps a negative median to zero: honesty is never punished', () => {
    const k = computeKickbackScore({ medianRho: -0.4 });
    expect(k.score).toBe(0);
    expect(k.components.medianRho).toBe(-0.4);
    expect(k.components.rhoClamped).toBe(0);
  });

  it('rejects out-of-range inputs instead of producing a wrong number', () => {
    expect(() => computeKickbackScore({ medianRho: 2 })).toThrow();
    expect(() => computeKickbackScore({ medianRho: 0, omissionIndex: 5 })).toThrow();
  });
});

describe('input validation: malformed picks throw instead of mis-scoring', () => {
  it('rejects duplicate positions', () => {
    const bad: ScoredPick[] = [
      { position: 1, rate: 0.1, monetized: true },
      { position: 1, rate: 0.2, monetized: true },
    ];
    expect(() =>
      computeArticleMetrics({ id: 'a', picks: bad, disclosureGrade: 'A' }),
    ).toThrow();
  });

  it('rejects non-positive and non-integer positions and out-of-range rates', () => {
    expect(() =>
      computeArticleMetrics({
        id: 'a',
        picks: [{ position: 0, rate: 0.1, monetized: true }],
        disclosureGrade: 'A',
      }),
    ).toThrow();
    expect(() =>
      computeArticleMetrics({
        id: 'a',
        picks: [{ position: 1, rate: 1.5, monetized: true }],
        disclosureGrade: 'A',
      }),
    ).toThrow();
  });

  it('§0.1: rejects a positive rate on an unmonetized pick (contradiction)', () => {
    expect(() =>
      computeArticleMetrics({
        id: 'a',
        picks: [{ position: 1, rate: 0.05, monetized: false }],
        disclosureGrade: 'A',
      }),
    ).toThrow(/unmonetized/);
  });
});

describe('scorePublisher end to end — the v0.6 report card', () => {
  it('produces a distribution-first report above the publication threshold', () => {
    const report = scorePublisher(many(25, 's', (id) => suspiciousArticle(id)));
    expect(report.status).toBe('ok');
    expect(report.meanMonetizedRatio).toBeCloseTo(0.8, 10);
    expect(report.distribution!.median).toBeCloseTo(0.9, 10);
    expect(report.distribution!.publishable).toBe(true);
    expect(report.distribution!.lowHeterogeneity).toBe(true);
    expect(report.kickback!.score).toBeCloseTo(90, 10);
    expect(report.gamingFlagCount).toBe(0);
    expect(report.pooledContinuity!.rho).toBeCloseTo(0.9, 10);
    expect(report.pooledContinuity!.warning).toBe(POOLED_RHO_WARNING);
    expect(report.spp).toBeNull();
  });

  it('HONEST publisher scores Kickback = 0; the signed median stays visible', () => {
    const report = scorePublisher(many(25, 'h', (id) => honestArticle(id)));
    expect(report.status).toBe('ok');
    expect(report.distribution!.median).toBeCloseTo(-0.9, 10);
    expect(report.kickback!.score).toBe(0);
    expect(report.kickback!.components.medianRho).toBeCloseTo(-0.9, 10);
  });

  it('reports insufficient data below the threshold — no score', () => {
    const report = scorePublisher(many(5, 's', (id) => suspiciousArticle(id)));
    expect(report.status).toBe('insufficient_data');
    expect(report.kickback).toBeNull();
    expect(report.distribution!.publishable).toBe(false);
  });

  it('publishes exclusion counts BY REASON; a monotone article pools and flags but cannot move K', () => {
    const corpus = [
      ...many(21, 's', (id) => suspiciousArticle(id)),
      soloArticle('solo', 4, 1),
      article('short', [0.1, 0.05]),
      monotoneArticle('mono'),
    ];
    const report = scorePublisher(corpus);
    expect(report.articleCount).toBe(24);
    expect(report.distribution!.qualifyingArticles).toBe(22);
    expect(report.excludedFromPool).toBe(2);
    expect(report.exclusionCounts).toEqual({
      fewer_than_2_priced_picks: 1,
      fewer_than_4_rated_picks: 1,
      rate_coverage_undefined: 0,
      rate_coverage_below_threshold: 0,
      rho_undefined: 0,
    });
    expect(report.distribution!.median).toBeCloseTo(0.9, 10);
    expect(report.kickback!.score).toBeCloseTo(90, 10);
    expect(report.gamingFlagCount).toBe(1);
    expect(report.spp!.articles).toBe(1);
    expect(report.spp!.publishable).toBe(false);
  });

  it('SPP is never folded into K: identical corpus scores the same K with or without solo articles', () => {
    const base = many(20, 's', (id) => suspiciousArticle(id));
    const withSolo = [...base, ...many(25, 'x', (id) => soloArticle(id, 5, 1))];
    const kBase = scorePublisher(base).kickback!.score;
    const reportWithSolo = scorePublisher(withSolo);
    expect(reportWithSolo.kickback!.score).toBeCloseTo(kBase, 10);
    expect(reportWithSolo.spp!.publishable).toBe(true);
    expect(reportWithSolo.spp!.spp1).toBe(1);
  });

  it('GATE: a publisher with no affiliate revenue is not scored', () => {
    const clean = many(30, 'c', (id) =>
      article(id, [null, null, null, null], 'A', [false, false, false, false]),
    );
    const report = scorePublisher(clean);
    expect(report.meanMonetizedRatio).toBe(0);
    expect(report.takesNoAffiliateRevenue).toBe(true);
    expect(report.status).toBe('not_scored_no_revenue');
    expect(report.distribution).toBeNull();
    expect(report.kickback).toBeNull();
    expect(report.gamingFlagCount).toBe(0);
    expect(report.pooledContinuity).toBeNull();
    expect(report.spp).toBeNull();
  });
});
