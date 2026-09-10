/**
 * Statistical inference — SPEC-scoring.md v0.6 §1.6 (SPP) and §2 (the article
 * distribution, its id-keyed bootstrap CI, the gaming flag, the demoted ρ).
 *
 * The §2.4 FALSIFICATION RECORD lives here as a first-class test: it IS the
 * proof the estimator is sound. If an attack is found that moves the
 * count-thresholded median the way summand-injection moved the pooled mean,
 * that test fails and the estimator must change before any score is published.
 */
import { describe, expect, it } from 'vitest';
import {
  articleRho,
  computeArticleMetrics,
  computePayoutRankDistribution,
  computeSolePaidPlacement,
  demotedPooledRho,
  gamingFlagCount,
  normalCdf,
  poissonBinomialUpperTail,
  quantileType7,
  sampleVariance,
  scorePublisher,
  BOOTSTRAP_RESAMPLES,
  BOOTSTRAP_SEED,
  GAMING_FLAG_MAX_N,
  GAMING_FLAG_RHO,
  MIN_SPP_ARTICLES,
  POOLED_RHO_WARNING,
  SPP_EXACT_LIMIT,
  SPP_PERMUTATIONS,
  type ArticleInput,
  type ArticleMetrics,
} from '../src/index.js';
import { ARTICLE_STREAM_DOMAIN, createStream, hashStrings } from '../src/random.js';
import {
  article,
  honestArticle,
  many,
  monotoneArticle,
  organicMonotone6,
  soloArticle,
  suspiciousArticle,
  tiedArticle,
} from './helpers.js';

const metricsOf = (...articles: ArticleInput[]): ArticleMetrics[] =>
  articles.map(computeArticleMetrics);

/** Heterogeneous 21-article corpus (3-value ρ mix) with a given id prefix. */
const heterogeneous = (prefix: string): ArticleMetrics[] =>
  metricsOf(
    ...many(7, `${prefix}h`, (id) => honestArticle(id)), //  ρ = -0.9
    ...many(7, `${prefix}t`, (id) => tiedArticle(id)), //    ρ ≈ 0.813
    ...many(7, `${prefix}s`, (id) => suspiciousArticle(id)), // ρ = 0.9
  );

describe('statistics primitives', () => {
  it('sampleVariance uses the (m − 1) divisor', () => {
    expect(sampleVariance([1, 2, 3, 4])).toBeCloseTo(5 / 3, 12);
    expect(() => sampleVariance([1])).toThrow();
  });

  it('quantileType7 matches the §2.1 canonical wording (h = (N−1)·q, linear interpolation)', () => {
    expect(quantileType7([1, 2, 3, 4], 0.25)).toBeCloseTo(1.75, 12);
    expect(quantileType7([1, 2, 3, 4], 0.5)).toBeCloseTo(2.5, 12);
    expect(quantileType7([1, 2, 3, 4], 0.75)).toBeCloseTo(3.25, 12);
    expect(quantileType7([5, 1, 3], 0.5)).toBe(3); // unsorted input, odd n
  });

  it('normalCdf matches the standard normal', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 7);
    expect(normalCdf(1.96)).toBeCloseTo(0.9750021, 5);
  });

  it('poissonBinomialUpperTail is exact (hand-computed 3-article case)', () => {
    expect(poissonBinomialUpperTail([0.25, 0.25, 0.2], 2)).toBeCloseTo(0.1375, 10);
    expect(poissonBinomialUpperTail([0.25, 0.25, 0.2], 0)).toBe(1);
    expect(poissonBinomialUpperTail([0.25, 0.25, 0.2], 4)).toBe(0);
  });
});

describe('§2.1/§2.2 the article distribution', () => {
  it('publishes median, IQR, n over the qualifying set', () => {
    const dist = computePayoutRankDistribution(metricsOf(...many(21, 's', suspiciousArticle)))!;
    expect(dist.median).toBeCloseTo(0.9, 10);
    expect(dist.q1).toBeCloseTo(0.9, 10);
    expect(dist.q3).toBeCloseTo(0.9, 10);
    expect(dist.qualifyingArticles).toBe(21);
    expect(dist.publishable).toBe(true);
  });

  it('zero-width CI on clustered rho is EXPECTED and labeled low-heterogeneity, not precision', () => {
    const dist = computePayoutRankDistribution(metricsOf(...many(21, 's', suspiciousArticle)))!;
    expect(dist.ci95).toEqual([0.9, 0.9]);
    expect(dist.lowHeterogeneity).toBe(true);
  });

  it('a heterogeneous corpus gets a real-width CI and no heterogeneity label', () => {
    const dist = computePayoutRankDistribution(heterogeneous('p'))!;
    expect(dist.median).toBeCloseTo(articleRho(tiedArticle('x').picks)!, 10);
    expect(dist.ci95[1] - dist.ci95[0]).toBeGreaterThan(0);
    expect(dist.lowHeterogeneity).toBe(false);
  });

  it('REGRESSION: the CI is deterministic across runs (published RNG, id-derived stream)', () => {
    const a = computePayoutRankDistribution(heterogeneous('p'))!;
    const b = computePayoutRankDistribution(heterogeneous('p'))!;
    expect(b).toEqual(a);
  });

  it('REGRESSION (§0.2): the distribution is independent of processing order — keyed on ids', () => {
    const mixed = heterogeneous('p');
    const forward = computePayoutRankDistribution(mixed)!;
    const backward = computePayoutRankDistribution([...mixed].reverse())!;
    expect(backward).toEqual(forward);
  });

  it('REGRESSION (§0.2, v0.5 collision): identical ρ multisets, different ids → DIFFERENT streams', () => {
    // v0.5 keyed the stream to ρ-content, so these two publishers would have
    // shared a stream. v0.6 keys to the sorted article-id set.
    const idsA = many(21, 'pubA-', (id) => suspiciousArticle(id)).map((a) => a.id).sort();
    const idsB = many(21, 'pubB-', (id) => suspiciousArticle(id)).map((a) => a.id).sort();
    expect(hashStrings(idsA)).not.toBe(hashStrings(idsB));
    const streamA = createStream(BOOTSTRAP_SEED, ARTICLE_STREAM_DOMAIN, hashStrings(idsA));
    const streamB = createStream(BOOTSTRAP_SEED, ARTICLE_STREAM_DOMAIN, hashStrings(idsB));
    expect(streamA.nextUint32()).not.toBe(streamB.nextUint32());
    // The point estimates are functions of the ρ multiset and stay equal;
    // only the resample stream (and hence potentially the CI bytes) differs.
    const dA = computePayoutRankDistribution(heterogeneous('pubA-'))!;
    const dB = computePayoutRankDistribution(heterogeneous('pubB-'))!;
    expect(dB.median).toBe(dA.median);
    expect(dB.q1).toBe(dA.q1);
    expect(dB.q3).toBe(dA.q3);
  });

  it('marks publishable only at >= 20 qualifying articles', () => {
    expect(
      computePayoutRankDistribution(metricsOf(...many(19, 's', suspiciousArticle)))!.publishable,
    ).toBe(false);
    expect(
      computePayoutRankDistribution(metricsOf(...many(20, 's', suspiciousArticle)))!.publishable,
    ).toBe(true);
  });

  it('ignores non-qualifying articles; null when nothing qualifies', () => {
    expect(computePayoutRankDistribution(metricsOf(soloArticle('a', 4, 1)))).toBeNull();
    const dist = computePayoutRankDistribution(
      metricsOf(suspiciousArticle('a'), soloArticle('b', 4, 1)),
    )!;
    expect(dist.qualifyingArticles).toBe(1);
  });

  it('throws on duplicate article ids (corpus primary key)', () => {
    const twice = metricsOf(suspiciousArticle('same'), honestArticle('same'));
    expect(() => computePayoutRankDistribution(twice)).toThrow(/duplicate/);
  });

  it('constants: B = 2000 resamples, published seed', () => {
    expect(BOOTSTRAP_RESAMPLES).toBe(2000);
    expect(BOOTSTRAP_SEED).toBe(0xd15c105e);
  });
});

describe('§2.4 FALSIFICATION RECORD — the acceptance spec for the estimator', () => {
  const A = () => metricsOf(...many(21, 's', suspiciousArticle), ...many(1, 'm', monotoneArticle));
  const B = () => metricsOf(...many(21, 's', suspiciousArticle), ...many(5, 'm', monotoneArticle));
  const C = () =>
    metricsOf(...many(21, 's', suspiciousArticle), ...many(50, 'm', monotoneArticle));

  it('median moves 0.90 → 0.90 → 1.00 across {+1}, {+5}, {+50}', () => {
    expect(computePayoutRankDistribution(A())!.median).toBeCloseTo(0.9, 10);
    expect(computePayoutRankDistribution(B())!.median).toBeCloseTo(0.9, 10);
    expect(computePayoutRankDistribution(C())!.median).toBeCloseTo(1.0, 10);
  });

  it('the median CI NEVER collapses around a contaminated value while a clean majority exists', () => {
    for (const make of [A, B]) {
      const dist = computePayoutRankDistribution(make())!;
      expect(dist.ci95).toEqual([0.9, 0.9]);
      expect(dist.ci95[1]).toBeLessThan(1);
      expect(dist.lowHeterogeneity).toBe(true);
    }
  });

  it('past the 50% breakdown the median saturates HONESTLY and the composition stays visible', () => {
    const dist = computePayoutRankDistribution(C())!;
    expect(dist.median).toBeCloseTo(1.0, 10);
    expect(dist.ci95).toEqual([1.0, 1.0]);
    expect(dist.q1).toBeCloseTo(0.9, 10); // the IQR still shows the mixture
  });

  it('the gaming flag rises 1 → 5 → 50, monotonically, making the +50 case self-evident', () => {
    expect(gamingFlagCount(A())).toBe(1);
    expect(gamingFlagCount(B())).toBe(5);
    expect(gamingFlagCount(C())).toBe(50);
  });

  it('K no longer moves under summand injection: 90 at +0, +1, and +5', () => {
    const k = (extra: ArticleInput[]) =>
      scorePublisher([...many(21, 's', suspiciousArticle), ...extra]).kickback!.score;
    expect(k([])).toBeCloseTo(90, 10);
    expect(k([monotoneArticle('m0')])).toBeCloseTo(90, 10);
    expect(k(many(5, 'm', monotoneArticle))).toBeCloseTo(90, 10);
  });
});

describe('§2.5 gaming flag — the pinned n <= 5 gate', () => {
  it('publishes the pinned constants', () => {
    expect(GAMING_FLAG_RHO).toBe(0.99);
    expect(GAMING_FLAG_MAX_N).toBe(5);
  });

  it('REGRESSION: a 5-pick rho = 1 article MUST trip it', () => {
    const m = computeArticleMetrics(monotoneArticle('m'));
    expect(m.rho).toBeCloseTo(1, 10);
    expect(m.n).toBe(5);
    expect(gamingFlagCount([m])).toBe(1);
  });

  it('REGRESSION: an organic rho = 1 article at n >= 6 must NOT trip it', () => {
    const m = computeArticleMetrics(organicMonotone6('o'));
    expect(m.rho).toBeCloseTo(1, 10);
    expect(m.n).toBe(6);
    expect(m.qualifiesForPool).toBe(true);
    expect(gamingFlagCount([m])).toBe(0);
  });

  it('rho at or below 0.99 never flags, and non-qualifying articles never flag', () => {
    expect(gamingFlagCount(metricsOf(suspiciousArticle('s')))).toBe(0);
    expect(gamingFlagCount(metricsOf(soloArticle('a', 4, 1)))).toBe(0);
  });
});

describe('§2.6 the demoted pooled rho — warned component, never load-bearing', () => {
  it('carries the byte-exact de-versioned warning (v0.6.1)', () => {
    expect(POOLED_RHO_WARNING).toBe(
      'Pooled ρ is weight-neutral and is dominated by extreme-ρ articles; it is shown for continuity only. The headline is the article-distribution median.',
    );
  });

  it('is the unweighted mean of clamped z, with the fixed published warning', () => {
    const ms = metricsOf(...many(21, 's', suspiciousArticle), monotoneArticle('m'));
    const demoted = demotedPooledRho(ms)!;
    const zs = ms.map((m) => Math.atanh(Math.max(-(1 - 1e-6), Math.min(1 - 1e-6, m.rho!))));
    const zMean = zs.reduce((a, b) => a + b, 0) / zs.length;
    expect(demoted.z).toBeCloseTo(zMean, 12);
    expect(demoted.rho).toBeCloseTo(Math.tanh(zMean), 12);
    expect(demoted.warning).toBe(POOLED_RHO_WARNING);
  });

  it('FISHER_RHO_CLAMP moves nothing published in the headline — only the warned component', () => {
    const report = scorePublisher([...many(21, 's', suspiciousArticle), monotoneArticle('m')]);
    // Every headline value is recomputable from the RAW rho list with the
    // pinned type-7 quantiles — no arctanh, no clamp, anywhere.
    const rhos = report.articles.filter((a) => a.qualifiesForPool).map((a) => a.rho!);
    expect(report.distribution!.median).toBe(quantileType7(rhos, 0.5));
    expect(report.distribution!.q1).toBe(quantileType7(rhos, 0.25));
    expect(report.distribution!.q3).toBe(quantileType7(rhos, 0.75));
    expect(report.kickback!.score).toBeCloseTo(100 * Math.max(0, quantileType7(rhos, 0.5)), 10);
    expect(report.gamingFlagCount).toBe(1);
    const demote = (clamp: number) =>
      Math.tanh(
        rhos
          .map((r) => Math.atanh(Math.max(-clamp, Math.min(clamp, r))))
          .reduce((a, b) => a + b, 0) / rhos.length,
      );
    expect(report.pooledContinuity!.rho).toBeCloseTo(demote(1 - 1e-6), 12);
    expect(Math.abs(demote(1 - 1e-6) - demote(1 - 1e-9))).toBeGreaterThan(0.001);
  });
});

describe('§1.6 + §2.5: SPP and the gaming flag are disjoint populations', () => {
  it('no article counts toward both (k = 1 vs k >= 2 by construction)', () => {
    const ms = [
      ...metricsOf(...many(20, 's', suspiciousArticle), monotoneArticle('m')),
      ...metricsOf(soloArticle('x1', 4, 1), soloArticle('x2', 5, 2), soloArticle('x3', 6, 1)),
    ];
    const sppMembers = ms.filter((m) => m.kPricedPicks === 1 && m.solePaidPosition !== null);
    const flagMembers = ms.filter(
      (m) =>
        m.qualifiesForPool && m.rho !== null && m.rho > GAMING_FLAG_RHO && m.n <= GAMING_FLAG_MAX_N,
    );
    expect(sppMembers).toHaveLength(3);
    expect(flagMembers).toHaveLength(1);
    for (const m of flagMembers) expect(m.kPricedPicks).toBeGreaterThanOrEqual(2);
    for (const m of sppMembers) expect(m.qualifiesForPool).toBe(false);
    expect(computeSolePaidPlacement(ms)!.articles).toBe(3);
    expect(gamingFlagCount(ms)).toBe(1);
  });
});

describe('§1.6 Sole-Paid-Pick Placement (unchanged in v0.6)', () => {
  it('computes SPP-1 exactly (hand-computed 3-article case)', () => {
    const spp = computeSolePaidPlacement(
      metricsOf(soloArticle('a', 4, 1), soloArticle('b', 4, 1), soloArticle('c', 5, 3)),
    )!;
    expect(spp.articles).toBe(3);
    expect(spp.observedTop).toBe(2);
    expect(spp.expectedTop).toBeCloseTo(0.7, 12);
    expect(spp.variance).toBeCloseTo(0.535, 12);
    expect(spp.z).toBeCloseTo(1.7773, 3);
    expect(spp.pValue).toBeCloseTo(0.1375, 10);
    expect(spp.pValueMethod).toBe('exact_poisson_binomial');
    expect(spp.spp1).toBeCloseTo(2 / 3, 12);
    expect(spp.publishable).toBe(false);
  });

  it('computes SPP-mean with its exact null mean and a permutation p-value', () => {
    const spp = computeSolePaidPlacement(
      metricsOf(soloArticle('a', 4, 1), soloArticle('b', 4, 1), soloArticle('c', 5, 3)),
    )!;
    expect(spp.meanU).toBeCloseTo(2.6 / 3, 12);
    expect(spp.nullMeanU).toBeCloseTo(1.85 / 3, 12);
    expect(spp.permutations).toBe(SPP_PERMUTATIONS);
    expect(spp.meanPValue).toBeGreaterThan(0);
    expect(spp.meanPValue).toBeLessThanOrEqual(1);
  });

  it('is deterministic and switches to the normal approximation above the exact limit', () => {
    const inputs = metricsOf(soloArticle('a', 4, 1), soloArticle('b', 6, 2), soloArticle('c', 5, 3));
    expect(computeSolePaidPlacement(inputs)).toEqual(computeSolePaidPlacement(inputs));

    expect(SPP_EXACT_LIMIT).toBe(500);
    const many501 = metricsOf(
      ...Array.from({ length: 501 }, (_, i) => soloArticle(`q${i}`, 5, 1)),
    );
    const spp = computeSolePaidPlacement(many501)!;
    expect(spp.pValueMethod).toBe('normal_approximation');
    expect(spp.z).toBeCloseTo(44.77, 1);
    expect(spp.pValue).toBeLessThan(1e-10);
  });

  it('publishes only at |A1| >= 20', () => {
    expect(MIN_SPP_ARTICLES).toBe(20);
    const nineteen = metricsOf(
      ...Array.from({ length: 19 }, (_, i) => soloArticle(`n${i}`, 5, 2)),
    );
    const twenty = metricsOf(
      ...Array.from({ length: 20 }, (_, i) => soloArticle(`t${i}`, 5, 2)),
    );
    expect(computeSolePaidPlacement(nineteen)!.publishable).toBe(false);
    expect(computeSolePaidPlacement(twenty)!.publishable).toBe(true);
  });

  it('returns null when no article has exactly one priced pick', () => {
    expect(computeSolePaidPlacement(metricsOf(suspiciousArticle('s')))).toBeNull();
  });
});
