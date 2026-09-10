/**
 * Scoring math — SPEC-scoring.md v0.5, implemented exactly as published.
 *
 * Every number produced here must be recomputable by a hostile third party
 * from published inputs, including the bootstrap RNG seed (see random.ts for
 * the full published RNG specification).
 *
 * v0.5 (final scoring version; see the spec changelog):
 *  - §2: the publisher headline is the DISTRIBUTION of ρ_a — median, IQR, n —
 *    never a pooled scalar. Pooling is a sum over articles and any weighted
 *    sum is movable by contributing summands (adversarially or by an ordinary
 *    skewed honest corpus); order statistics do not sum. The v0.2–v0.4 weight
 *    machinery (inverse-variance weights, variance floor, within-article
 *    bootstrap) is DELETED.
 *  - §2.2: R_median = unweighted median of ρ_a, with an ARTICLE-set bootstrap
 *    CI (B = 2000, published RNG, content-derived stream). A zero-width CI on
 *    clustered ρ_a means LOW HETEROGENEITY, never high confidence, and is
 *    labeled as such.
 *  - §2.5: the gaming flag — |{a ∈ Q_p : ρ_a > 0.99 ∧ n_a ≤ 5}| — is a
 *    first-class published metric. The n ≤ 5 gate is pinned.
 *  - §2.6: pooled ρ_p survives only as a warned continuity component
 *    (unweighted mean of clamped z), never a Kickback input.
 *  - §3: K reads R = max(0, R_median).
 *
 * The §2.4 falsification record is encoded as a first-class test in
 * test/inference.test.ts; if an attack moves the median the way summand
 * injection moved the pooled mean, that test fails and the estimator must
 * change before any score is published.
 *
 * The omission index (§4) is NOT implemented; with O null, K = 100 × R.
 *
 * Malformed input throws instead of mis-scoring: a wrong number published is
 * worse than a crashed pipeline.
 */
import {
  ARTICLE_STREAM_DOMAIN,
  BOOTSTRAP_SEED,
  SPP_STREAM_DOMAIN,
  createStream,
  hashInts,
  hashStrings,
} from './random.js';
import { median, normalCdf, poissonBinomialUpperTail, quantileType7, spearman } from './stats.js';
import type { ArticleInput, DisclosureGrade, RateKind, ScoredPick } from './types.js';

export { BOOTSTRAP_SEED } from './random.js';

// ---------------------------------------------------------------------------
// Published constants (changing any of these is a public, versioned event)
// ---------------------------------------------------------------------------

/** §1.4: minimum priced picks (monetized AND known rate) for pool inclusion. */
export const MIN_PRICED_PICKS = 2;

/** §1.4: minimum picks with a determined r_i for pool inclusion. */
export const MIN_RATED_PICKS = 4;

/** §1.2/§1.4: minimum rate coverage C_a for pool inclusion. */
export const MIN_RATE_COVERAGE = 0.6;

/** §2.2: minimum qualifying articles before any score is published. */
export const MIN_QUALIFYING_ARTICLES = 20;

/** §1.6: minimum |A₁| before SPP is published. */
export const MIN_SPP_ARTICLES = 20;

/** §2.2: article-set bootstrap resamples for the median CI. */
export const BOOTSTRAP_RESAMPLES = 2000;

/** §1.6: exact Poisson-binomial p-value up to this |A₁|; normal approximation above. */
export const SPP_EXACT_LIMIT = 500;

/** §1.6: SPP-mean permutation resamples. */
export const SPP_PERMUTATIONS = 2000;

/** §2.5: gaming flag thresholds. The n ≤ 5 gate is load-bearing and PINNED. */
export const GAMING_FLAG_RHO = 0.99;
export const GAMING_FLAG_MAX_N = 5;

/**
 * §2.6: |ρ| is clamped to this before arctanh in the demoted continuity
 * component, keeping the intermediate finite. In v0.5 this constant touches
 * nothing on which a claim rests — the headline is clamp-free order statistics.
 */
export const FISHER_RHO_CLAMP = 1 - 1e-6;

/** §2.6: the fixed published warning carried by the demoted pooled ρ (de-versioned in v0.6.1). */
export const POOLED_RHO_WARNING =
  'Pooled ρ is weight-neutral and is dominated by extreme-ρ articles; it is shown for continuity only. The headline is the article-distribution median.';

/** §1.5: disclosure deficiency by grade. Purely positional; no judgment. */
export const DISCLOSURE_DEFICIENCY: Record<DisclosureGrade, number> = {
  A: 0,
  B: 0.25,
  C: 0.5,
  D: 0.75,
  F: 1,
};

/** §3: published Kickback weights. R = distribution median; O = omission index. */
export const KICKBACK_WEIGHTS = { R: 0.75, O: 0.25 } as const;
export const KICKBACK_WEIGHTS_VERSION = '3.0.0';

// ---------------------------------------------------------------------------
// r_i derivation (SPEC §0.1) and input validation
// ---------------------------------------------------------------------------

/**
 * The load-bearing r_i of SPEC §0.1, derived from (monetized, rate):
 *   - not monetized           → 0    (a KNOWN rate: the publisher earns nothing)
 *   - monetized, rate known   → rate
 *   - monetized, rate private → null
 *
 * **This function is unit-blind, and §0.1.3 is the reason that matters.** It
 * answers "what does this pick pay", not "is that comparable to what its
 * neighbours pay" — which is an ARTICLE-level question and is answered by
 * `effectiveRateInKind()` below, on top of this. Every caller that feeds a
 * correlation goes through that one.
 */
export function effectiveRate(pick: ScoredPick): number | null {
  return pick.monetized ? pick.rate : 0;
}

// ---------------------------------------------------------------------------
// §0.1.3 — rate KIND (v0.6.10). A rate is a number in a unit.
// ---------------------------------------------------------------------------

/** The default for a pick that names no kind: what every rate here was. */
export const DEFAULT_RATE_KIND: RateKind = 'percent_of_sale';

/** The four, and exactly the four. §0.1.3. */
export const RATE_KINDS: ReadonlySet<RateKind> = new Set<RateKind>([
  'percent_of_sale',
  'flat_bounty',
  'recurring_percent',
  'other',
]);

/** The grouping key: kind, plus currency for a bounty and only for a bounty. */
export function rateKindKey(pick: ScoredPick): string {
  const kind = pick.rateKind ?? DEFAULT_RATE_KIND;
  return kind === 'flat_bounty' ? `${kind}|${pick.rateCurrency ?? ''}` : kind;
}

export interface DominantRateKind {
  kind: RateKind;
  /** Set only for `flat_bounty`. A percentage is dimensionless. */
  currency: string | null;
  key: string;
  /** Priced picks of this kind. */
  count: number;
}

/**
 * §0.1.3 — the `(rate_kind, currency)` of the plurality of an article's PRICED
 * picks, or null when the article prices nothing.
 *
 * Computed over PRICED picks only — monetized, with a rate. An unmonetized
 * pick has no rate and therefore no unit; it enters ρ at `r_i = 0` whatever
 * the dominant kind is, because zero is zero in every unit.
 *
 * **Ties are broken by the highest-ranked priced pick**, which is deterministic
 * and data-driven. There is deliberately no fixed preference order between
 * kinds: choosing one would be us deciding which kind of payment matters.
 */
export function dominantRateKind(picks: readonly ScoredPick[]): DominantRateKind | null {
  const priced = picks
    .filter((p) => p.monetized && p.rate !== null)
    .sort((a, b) => a.position - b.position);
  if (priced.length === 0) return null;
  const counts = new Map<string, number>();
  for (const p of priced) {
    const key = rateKindKey(p);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let best = rateKindKey(priced[0]!);
  let bestCount = counts.get(best)!;
  // Ascending position order, so the FIRST key to reach the maximum count is
  // the one whose highest-ranked pick comes first — the stated tie-break.
  for (const p of priced) {
    const key = rateKindKey(p);
    const n = counts.get(key)!;
    if (n > bestCount) {
      best = key;
      bestCount = n;
    }
  }
  const winner = priced.find((p) => rateKindKey(p) === best)!;
  const kind = winner.rateKind ?? DEFAULT_RATE_KIND;
  return {
    kind,
    currency: kind === 'flat_bounty' ? (winner.rateCurrency ?? null) : null,
    key: best,
    count: bestCount,
  };
}

/**
 * §0.1.3 — `r_i` for the correlation: `effectiveRate`, except that a priced
 * pick of a kind other than the article's dominant one is `null`.
 *
 * An UNMONETIZED pick is unaffected and stays at 0. It is not a mismatch: it
 * carries no unit to mismatch with, and dropping the observation that a
 * publisher earns nothing on a top pick is the one bias SPEC §0.1 excludes
 * structurally.
 */
export function effectiveRateInKind(
  pick: ScoredPick,
  dominant: DominantRateKind | null,
): number | null {
  if (!pick.monetized) return 0;
  if (pick.rate === null) return null;
  if (dominant !== null && rateKindKey(pick) !== dominant.key) return null;
  return pick.rate;
}

/** §0.1.3 + §0.1.1: the same filter applied to the band's ceiling. */
export function effectiveRateMaxInKind(
  pick: ScoredPick,
  dominant: DominantRateKind | null,
): number | null {
  if (!pick.monetized) return 0;
  if (pick.rate === null) return null;
  if (dominant !== null && rateKindKey(pick) !== dominant.key) return null;
  return pick.rateMax ?? pick.rate;
}

/**
 * Picks a published rate exists for and the correlation still cannot use,
 * because it is in a different unit from the article's dominant one.
 *
 * Published per article and per card. A reader must be able to see how many
 * picks ρ could not see, and why — it is a gap in coverage, not an absence of
 * monetization, and `M̄` still counts every one of them.
 */
export function rateKindMismatchCount(picks: readonly ScoredPick[]): number {
  const dominant = dominantRateKind(picks);
  if (dominant === null) return 0;
  return picks.filter(
    (p) => p.monetized && p.rate !== null && rateKindKey(p) !== dominant.key,
  ).length;
}

/**
 * §0.1.1 sensitivity pass: `r_i` with every banded pick at its published
 * CEILING instead of its floor. A point rate is a degenerate band, so this
 * equals effectiveRate() wherever `rateMax` is absent.
 *
 * Never a midpoint. An interpolated rate has no provenance.
 */
export function effectiveRateMax(pick: ScoredPick): number | null {
  if (!pick.monetized) return 0;
  if (pick.rate === null) return null;
  return pick.rateMax ?? pick.rate;
}

/** A monetized pick whose floor and ceiling differ, from either cause. */
function hasSpread(pick: ScoredPick): boolean {
  return (
    pick.monetized &&
    pick.rate !== null &&
    pick.rateMax !== null &&
    pick.rateMax !== undefined &&
    pick.rateMax > pick.rate
  );
}

/** §0.1.2: the pick's links reach two or more distinct merchants. */
export function isMultiMerchant(pick: ScoredPick): boolean {
  return pick.monetized && pick.multiMerchant === true;
}

/**
 * §0.1.1: a pick whose SINGLE merchant publishes a range rather than a point
 * rate. A multi-merchant pick also has a spread, but it is a different
 * unknown (§0.1.2) and is excluded here so the two are counted separately.
 */
export function isBanded(pick: ScoredPick): boolean {
  return hasSpread(pick) && !isMultiMerchant(pick);
}

/**
 * §0.1.1: an article is `band_sensitive` when the choice of floor versus
 * ceiling changes the conclusion — the sign of `rho_a` flips, or the two
 * values differ by more than this.
 */
export const BAND_SENSITIVITY_SPREAD = 0.2;

function validatePicks(picks: readonly ScoredPick[]): void {
  const positions = new Set<number>();
  for (const pick of picks) {
    if (!Number.isInteger(pick.position) || pick.position < 1) {
      throw new TypeError(`pick position must be a positive integer, got ${pick.position}`);
    }
    if (positions.has(pick.position)) {
      throw new TypeError(`duplicate pick position ${pick.position}`);
    }
    positions.add(pick.position);
    // §0.1.3 (v0.6.10). The unit decides what a legal `rate` even is.
    const kind = pick.rateKind ?? DEFAULT_RATE_KIND;
    if (!RATE_KINDS.has(kind)) {
      throw new TypeError(`unknown rateKind "${kind}" at position ${pick.position}`);
    }
    if (kind === 'flat_bounty') {
      // A bounty is an AMOUNT, so [0, 1] is not its range — and without a
      // currency it is not an amount at all. USD 40 and CAD 40 are different
      // numbers and a table that mixes them has no unit.
      if (typeof pick.rateCurrency !== 'string' || pick.rateCurrency.trim() === '') {
        throw new TypeError(
          `a flat_bounty pick must carry a currency (position ${pick.position}); ` +
            'USD 40 and CAD 40 are different amounts',
        );
      }
    } else if (pick.rateCurrency !== undefined) {
      // A percentage is dimensionless. Carrying a currency on one asserts
      // otherwise and would make two identical percentages group apart.
      throw new TypeError(
        `rateCurrency is only meaningful on a flat_bounty; got "${pick.rateCurrency}" on a ` +
          `${kind} pick at position ${pick.position}`,
      );
    }
    if (kind === 'other' && pick.rate !== null) {
      throw new TypeError(
        `rateKind "other" means a structure we cannot reduce to one number, so its rate must ` +
          `be null; got ${pick.rate} at position ${pick.position}`,
      );
    }
    if (pick.rate !== null) {
      const percentLike = kind === 'percent_of_sale' || kind === 'recurring_percent';
      if (!Number.isFinite(pick.rate) || pick.rate < 0 || (percentLike && pick.rate > 1)) {
        throw new TypeError(
          `rate must be null or a decimal in [0, 1], got ${pick.rate} at position ${pick.position}`,
        );
      }
      // §0.1: an unmonetized pick earns nothing. A positive rate on it is a
      // contradiction and must throw.
      if (!pick.monetized && pick.rate > 0) {
        throw new TypeError(
          `unmonetized pick at position ${pick.position} must have rate null or 0, got ${pick.rate}`,
        );
      }
    }
    // §0.1.1 band validation — WITHIN the kind (§0.1.3): a bounty band is a
    // band of amounts and its ceiling is not capped at 1 either.
    if (pick.rateMax !== null && pick.rateMax !== undefined) {
      const percentLike = kind === 'percent_of_sale' || kind === 'recurring_percent';
      if (!Number.isFinite(pick.rateMax) || pick.rateMax < 0 || (percentLike && pick.rateMax > 1)) {
        throw new TypeError(
          `rateMax must be null or a decimal in [0, 1], got ${pick.rateMax} at position ${pick.position}`,
        );
      }
      if (!pick.monetized && pick.rateMax > 0) {
        throw new TypeError(
          `unmonetized pick at position ${pick.position} must have rateMax null or 0, got ${pick.rateMax}`,
        );
      }
      if (pick.rate === null && pick.rateMax > 0) {
        throw new TypeError(
          `pick at position ${pick.position} has a null rate but a positive rateMax; a band needs both ends`,
        );
      }
      if (pick.rate !== null && pick.rateMax < pick.rate) {
        throw new TypeError(
          `rateMax ${pick.rateMax} is below rate ${pick.rate} at position ${pick.position}; that is not a band`,
        );
      }
    }
    // §0.1.2: multi_merchant asserts that several merchants were compared.
    // Claiming it with fewer than two makes the published merchant list
    // unable to justify the minimum it produced.
    if (pick.multiMerchant === true && (pick.merchants ?? []).length < 2) {
      throw new TypeError(
        `pick at position ${pick.position} sets multiMerchant but lists ` +
          `${(pick.merchants ?? []).length} merchant(s); §0.1.2 needs at least 2`,
      );
    }
  }
}

function assertUnitInterval(name: string, value: number, lo = 0, hi = 1): void {
  if (!Number.isFinite(value) || value < lo || value > hi) {
    throw new TypeError(`${name} must be in [${lo}, ${hi}], got ${value}`);
  }
}

function clampRho(rho: number): number {
  return Math.max(-FISHER_RHO_CLAMP, Math.min(FISHER_RHO_CLAMP, rho));
}

// ---------------------------------------------------------------------------
// §1 Per-article metrics
// ---------------------------------------------------------------------------

/** §1.1  M_a = Σ m_i / n_a. A fact, never scored. Null for an empty article. */
export function monetizedRatio(picks: readonly ScoredPick[]): number | null {
  validatePicks(picks);
  if (picks.length === 0) return null;
  return picks.filter((p) => p.monetized).length / picks.length;
}

/**
 * §1.2  C_a = k_a / |{i : m_i = 1}|. "Of the monetized picks, what fraction do
 * we know the rate for." Bounded [0, 1]. Null when nothing is monetized.
 */
export function rateCoverage(picks: readonly ScoredPick[]): number | null {
  validatePicks(picks);
  const monetized = picks.filter((p) => p.monetized);
  if (monetized.length === 0) return null;
  // §0.1.3: a rate the correlation cannot use is not coverage. A mismatched
  // pick LEAVES the numerator and STAYS in the denominator, so coverage falls
  // — which is the honest direction: we hold a rate and cannot use it, and
  // that is a gap. `M̄` still counts the pick; only ρ cannot see it.
  const dominant = dominantRateKind(picks);
  const usable = monetized.filter(
    (p) => p.rate !== null && (dominant === null || rateKindKey(p) === dominant.key),
  );
  return usable.length / monetized.length;
}

export interface TopPickPremium {
  /** r_(rank 1) − median of the determined rates, in percentage points. */
  premiumPoints: number;
  /**
   * Percentile rank of the #1 pick's rate within the determined rates (its own
   * included): (count strictly below + 0.5 × count equal) / count.
   */
  percentile: number;
}

/** §1.3. Null when the #1 pick is monetized with an unknown rate. */
export function topPickPremium(picks: readonly ScoredPick[]): TopPickPremium | null {
  validatePicks(picks);
  const top = picks.find((p) => p.position === 1);
  if (!top) return null;
  const topRate = effectiveRate(top);
  if (topRate === null) return null;
  const known = picks.map(effectiveRate).filter((r): r is number => r !== null);
  const below = known.filter((r) => r < topRate).length;
  const equal = known.filter((r) => r === topRate).length;
  return {
    premiumPoints: (topRate - median(known)) * 100,
    percentile: (below + 0.5 * equal) / known.length,
  };
}

/**
 * §1.4  ρ_a = Spearman(s_i, r_i) over picks with a determined r_i, tie-aware,
 * where prominence s_i = n_a + 1 − p_i uses the FULL article length.
 * Unmonetized picks enter at r_i = 0 (§0.1). Null when undefined.
 */
export function articleRho(picks: readonly ScoredPick[]): number | null {
  validatePicks(picks);
  // §0.1.3: within ONE (rate_kind, currency). A pick of another kind is
  // `rate_kind_mismatch` and leaves the correlation, not the corpus.
  const dominant = dominantRateKind(picks);
  const rated = picks.filter((p) => effectiveRateInKind(p, dominant) !== null);
  if (rated.length < 2) return null;
  const n = picks.length;
  return spearman(
    rated.map((p) => n + 1 - p.position),
    rated.map((p) => effectiveRateInKind(p, dominant)!),
  );
}

/**
 * §0.1.1 sensitivity pass: ρ_a recomputed with every banded pick at its
 * published CEILING. Identical to articleRho() on an article with no bands.
 */
export function articleRhoAtRateMax(picks: readonly ScoredPick[]): number | null {
  validatePicks(picks);
  const dominant = dominantRateKind(picks);
  const rated = picks.filter((p) => effectiveRateMaxInKind(p, dominant) !== null);
  if (rated.length < 2) return null;
  const n = picks.length;
  return spearman(
    rated.map((p) => n + 1 - p.position),
    rated.map((p) => effectiveRateMaxInKind(p, dominant)!),
  );
}

export interface BandSensitivity {
  /** ρ_a at the published floor. THIS is the value the §2 distribution uses. */
  rhoAtRateMin: number | null;
  /** ρ_a at the published ceiling. Reported, never scored. */
  rhoAtRateMax: number | null;
  /** |ρ(min) − ρ(max)|, or null when either end is undefined. */
  spread: number | null;
  /** sign(ρ) differs between the two ends. */
  signFlip: boolean;
  /** signFlip OR spread > BAND_SENSITIVITY_SPREAD. */
  bandSensitive: boolean;
  /** §0.1.1 banded picks: one merchant, a published range. */
  bandedPickCount: number;
  /** §0.1.2 multi-merchant picks: several merchants, so several rates. */
  multiMerchantPickCount: number;
}

/**
 * §0.1.1: compute ρ_a twice and decide whether the band changes the
 * conclusion.
 *
 * INCOHERENCE, implemented literally and reported rather than fixed: the spec
 * says "if sign(ρ_a) differs". Under `Math.sign`, a ρ of exactly 0 at one end
 * and +0.5 at the other counts as a sign difference (0 vs 1), so an article
 * that moves from "no relationship" to "some relationship" is flagged
 * band_sensitive. That is arguably the right outcome — the band did change
 * the conclusion — but it is a consequence of the literal wording rather than
 * a stated intent, and a later amendment may want to say so explicitly.
 */
export function bandSensitivity(picks: readonly ScoredPick[]): BandSensitivity {
  const rhoAtRateMin = articleRho(picks);
  const rhoAtRateMax = articleRhoAtRateMax(picks);
  const bandedPickCount = picks.filter(isBanded).length;
  const multiMerchantPickCount = picks.filter(isMultiMerchant).length;
  if (rhoAtRateMin === null || rhoAtRateMax === null) {
    return {
      rhoAtRateMin,
      rhoAtRateMax,
      spread: null,
      signFlip: false,
      bandSensitive: false,
      bandedPickCount,
      multiMerchantPickCount,
    };
  }
  const spread = Math.abs(rhoAtRateMin - rhoAtRateMax);
  const signFlip = Math.sign(rhoAtRateMin) !== Math.sign(rhoAtRateMax);
  return {
    rhoAtRateMin,
    rhoAtRateMax,
    spread,
    signFlip,
    bandSensitive: signFlip || spread > BAND_SENSITIVITY_SPREAD,
    bandedPickCount,
    multiMerchantPickCount,
  };
}

export type ExclusionReason =
  | 'fewer_than_2_priced_picks'
  | 'fewer_than_4_rated_picks'
  | 'rate_coverage_undefined'
  | 'rate_coverage_below_threshold'
  | 'rho_undefined';

export interface ArticleMetrics {
  /** §0.2 stable article identity, carried through from ArticleInput. */
  id: string;
  n: number;
  nMonetized: number;
  /** Picks with a determined r_i (r_i ≠ null): priced plus unmonetized-at-zero. */
  nRatedPicks: number;
  /** k_a — picks that are monetized AND have a known rate ("priced"). */
  kPricedPicks: number;
  /** q_a — position of the sole priced pick, when k_a = 1 (§1.6). Else null. */
  solePaidPosition: number | null;
  /**
   * §0.1.1 sensitivity. `rho` above is ρ at the published FLOOR and is what
   * the §2 distribution consumes, band_sensitive articles included. These
   * carry the second computation so the card can publish the band.
   */
  rhoAtRateMax: number | null;
  bandSensitive: boolean;
  bandedPickCount: number;
  multiMerchantPickCount: number;
  /** The (s_i, r_i) pairs entering ρ_a, ascending position order. Published. */
  ratedPairs: ReadonlyArray<readonly [number, number]>;
  /**
   * §0.1.3 — the `(rate_kind, currency)` ρ_a was computed in, and how many
   * priced picks were excluded for being in another one. Both published: a
   * reader must be able to see what the correlation could not see.
   */
  dominantRateKind: RateKind | null;
  dominantRateCurrency: string | null;
  rateKindMismatchCount: number;
  monetizedRatio: number | null;
  rateCoverage: number | null;
  topPickPremium: TopPickPremium | null;
  rho: number | null;
  disclosureGrade: DisclosureGrade;
  disclosureDeficiency: number;
  /** §1.4 hard inclusion criteria (all three) for Q_p. */
  qualifiesForPool: boolean;
  /** Recorded and published by reason; exclusions are never silent. */
  exclusionReasons: ExclusionReason[];
}

export function computeArticleMetrics(article: ArticleInput): ArticleMetrics {
  const { id, picks, disclosureGrade } = article;
  if (typeof id !== 'string' || id.length === 0) {
    throw new TypeError('article id must be a non-empty string (§0.2)');
  }
  validatePicks(picks);
  const deficiency = DISCLOSURE_DEFICIENCY[disclosureGrade];
  if (deficiency === undefined) {
    throw new TypeError(`unknown disclosure grade "${disclosureGrade}"`);
  }

  // §0.1.3 — everything downstream of here is WITHIN the article's dominant
  // (rate_kind, currency). `dominant` is null when the article prices nothing,
  // and every *InKind helper then behaves exactly as its unit-blind twin.
  const dominant = dominantRateKind(picks);
  const rated = picks
    .filter((p) => effectiveRateInKind(p, dominant) !== null)
    .sort((a, b) => a.position - b.position);
  const n = picks.length;
  const ratedPairs = rated.map(
    (p) => [n + 1 - p.position, effectiveRateInKind(p, dominant)!] as const,
  );
  // k_a — priced picks the correlation can USE. A mismatched pick is priced in
  // the sense that we hold a number for it and is not priced in the sense
  // §1.4 needs, so it is out of k_a and its count is published beside it.
  const priced = picks.filter(
    (p) => p.monetized && p.rate !== null && (dominant === null || rateKindKey(p) === dominant.key),
  );
  const kPricedPicks = priced.length;
  const rateKindMismatches = rateKindMismatchCount(picks);
  const coverage = rateCoverage(picks);
  const rho = articleRho(picks);
  // §0.1.1: the distribution uses the rate_min value; the ceiling is carried
  // alongside so the publisher card can show the sensitivity band.
  const band = bandSensitivity(picks);

  const exclusionReasons: ExclusionReason[] = [];
  if (kPricedPicks < MIN_PRICED_PICKS) exclusionReasons.push('fewer_than_2_priced_picks');
  if (rated.length < MIN_RATED_PICKS) exclusionReasons.push('fewer_than_4_rated_picks');
  if (coverage === null) exclusionReasons.push('rate_coverage_undefined');
  else if (coverage < MIN_RATE_COVERAGE) exclusionReasons.push('rate_coverage_below_threshold');
  if (rho === null && rated.length >= MIN_RATED_PICKS && kPricedPicks >= MIN_PRICED_PICKS) {
    exclusionReasons.push('rho_undefined');
  }

  return {
    id,
    n,
    nMonetized: picks.filter((p) => p.monetized).length,
    nRatedPicks: rated.length,
    kPricedPicks,
    solePaidPosition: kPricedPicks === 1 ? priced[0]!.position : null,
    ratedPairs,
    dominantRateKind: dominant?.kind ?? null,
    dominantRateCurrency: dominant?.currency ?? null,
    rateKindMismatchCount: rateKindMismatches,
    monetizedRatio: monetizedRatio(picks),
    rateCoverage: coverage,
    topPickPremium: topPickPremium(picks),
    rho,
    disclosureGrade,
    disclosureDeficiency: deficiency,
    rhoAtRateMax: band.rhoAtRateMax,
    bandSensitive: band.bandSensitive,
    bandedPickCount: band.bandedPickCount,
    multiMerchantPickCount: band.multiMerchantPickCount,
    qualifiesForPool: exclusionReasons.length === 0,
    exclusionReasons,
  };
}

// ---------------------------------------------------------------------------
// §1.6 Sole-Paid-Pick Placement
// ---------------------------------------------------------------------------

export interface SolePaidPlacement {
  /** |A₁| — articles with exactly one priced pick. */
  articles: number;
  /** S — how many of them place that pick at rank #1. */
  observedTop: number;
  /** E = Σ 1/n_a under random placement. */
  expectedTop: number;
  /** Var = Σ (1/n_a)(1 − 1/n_a). */
  variance: number;
  /** Z = (S − E)/√Var. Null when Var = 0. */
  z: number | null;
  /** One-sided upper-tail p-value for S (§1.6). */
  pValue: number;
  pValueMethod: 'exact_poisson_binomial' | 'normal_approximation';
  /** S / |A₁| — the published headline fraction. */
  spp1: number;
  /** Observed mean of u_a = s_(q_a)/n_a. */
  meanU: number;
  /** Exact null mean of u_a, averaged over A₁: mean of (n_a + 1)/(2·n_a). */
  nullMeanU: number;
  /** One-sided permutation p-value for meanU, (m + 1)/(B + 1) estimator. */
  meanPValue: number;
  permutations: number;
  /** True only at |A₁| ≥ MIN_SPP_ARTICLES. */
  publishable: boolean;
}

interface SppArticle {
  n: number;
  kPricedPicks: number;
  solePaidPosition: number | null;
}

/**
 * §1.6: the cleanest test in the dataset. Where does the one pick the
 * publisher earns on land? Exact null, no ties, recomputable on paper.
 * NEVER folded into K or into ρ. Population is k_a = 1 — disjoint by
 * construction from the gaming flag's k_a ≥ 2 population (§1.6/§2.5).
 */
export function computeSolePaidPlacement(
  articles: readonly SppArticle[],
): SolePaidPlacement | null {
  const a1 = articles
    .filter((m) => m.kPricedPicks === 1 && m.solePaidPosition !== null)
    .map((m) => ({ n: m.n, q: m.solePaidPosition! }));
  if (a1.length === 0) return null;

  const observedTop = a1.filter((a) => a.q === 1).length;
  let expectedTop = 0;
  let variance = 0;
  for (const { n } of a1) {
    const p = 1 / n;
    expectedTop += p;
    variance += p * (1 - p);
  }
  const z = variance > 0 ? (observedTop - expectedTop) / Math.sqrt(variance) : null;

  let pValue: number;
  let pValueMethod: SolePaidPlacement['pValueMethod'];
  if (a1.length <= SPP_EXACT_LIMIT || z === null) {
    pValue = poissonBinomialUpperTail(
      a1.map((a) => 1 / a.n),
      observedTop,
    );
    pValueMethod = 'exact_poisson_binomial';
  } else {
    pValue = 1 - normalCdf(z);
    pValueMethod = 'normal_approximation';
  }

  const us = a1.map(({ n, q }) => (n + 1 - q) / n);
  const meanU = us.reduce((acc, u) => acc + u, 0) / us.length;
  const nullMeanU = a1.reduce((acc, { n }) => acc + (n + 1) / (2 * n), 0) / a1.length;

  // Permutation test (§1.6): simulate the null q_a ~ Uniform{1..n_a} with the
  // published RNG. The stream is MULTISET-keyed ((n_a, q_a) content), not
  // article-id-keyed like §2.2 — deliberate per §1.6/v0.6.1: a permutation
  // p-value is a function of the multiset under the null, so identical-multiset
  // publishers should obtain identical p-values.
  const canonical = [...a1].sort((a, b) => a.n - b.n || a.q - b.q);
  const rng = createStream(
    BOOTSTRAP_SEED,
    SPP_STREAM_DOMAIN,
    hashInts(canonical.flatMap(({ n, q }) => [n, q])),
  );
  let atLeast = 0;
  for (let b = 0; b < SPP_PERMUTATIONS; b++) {
    let sum = 0;
    for (const { n } of canonical) {
      const q = 1 + rng.nextIndex(n);
      sum += (n + 1 - q) / n;
    }
    if (sum / canonical.length >= meanU) atLeast++;
  }
  const meanPValue = (atLeast + 1) / (SPP_PERMUTATIONS + 1);

  return {
    articles: a1.length,
    observedTop,
    expectedTop,
    variance,
    z,
    pValue,
    pValueMethod,
    spp1: observedTop / a1.length,
    meanU,
    nullMeanU,
    meanPValue,
    permutations: SPP_PERMUTATIONS,
    publishable: a1.length >= MIN_SPP_ARTICLES,
  };
}

// ---------------------------------------------------------------------------
// §2.1/§2.2 The article distribution — the headline
// ---------------------------------------------------------------------------

/** The slice of ArticleMetrics that publisher-level §2 needs. */
export interface DistributionInput {
  /** §0.2 stable article identity — keys the §2.2 bootstrap stream. */
  id: string;
  rho: number | null;
  qualifiesForPool: boolean;
}

export interface PayoutRankDistribution {
  /** R_median — the headline number, signed. */
  median: number;
  /** Q1 of ρ_a over Q_p (type-7 quantile; published method). */
  q1: number;
  /** Q3 of ρ_a over Q_p. */
  q3: number;
  /**
   * Article-set bootstrap CI of the median (§2.2): 2.5th/97.5th percentiles
   * of B = 2000 resampled medians, published RNG, content-derived stream.
   */
  ci95: [number, number];
  /**
   * True when the CI has zero width. Means LOW ARTICLE HETEROGENEITY — the
   * publisher's ρ_a are clustered — never high confidence (§2.2). A reader
   * must never infer precision from a degenerate width.
   */
  lowHeterogeneity: boolean;
  /** n = |Q_p|. */
  qualifyingArticles: number;
  /** True only at n ≥ MIN_QUALIFYING_ARTICLES. No exceptions. */
  publishable: boolean;
}

/**
 * §2.1/§2.2: the published object — the distribution of ρ_a over the
 * qualifying set, summarized by unweighted order statistics. No weights, no
 * floor, no cap: order statistics do not sum, so summand injection cannot
 * move them the way it moved the pooled mean (§2.0, §2.4).
 */
export function computePayoutRankDistribution(
  articles: readonly DistributionInput[],
): PayoutRankDistribution | null {
  const qualifying: { id: string; rho: number }[] = [];
  const seen = new Set<string>();
  for (const a of articles) {
    if (!a.qualifiesForPool) continue;
    if (a.rho === null) {
      throw new TypeError('qualifying article has null rho; inclusion criteria were not applied');
    }
    if (seen.has(a.id)) {
      throw new TypeError(`duplicate article id "${a.id}" — id is the corpus primary key (§0.2)`);
    }
    seen.add(a.id);
    qualifying.push({ id: a.id, rho: a.rho });
  }
  if (qualifying.length === 0) return null;

  // §2.2/§0.2: canonical order and stream key are the sorted article ids —
  // article IDENTITY, not ρ-content — so the CI is reproducible per publisher
  // and independent of crawl/processing order.
  qualifying.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const n = qualifying.length;
  const rhosByIdOrder = qualifying.map((a) => a.rho);

  const rng = createStream(
    BOOTSTRAP_SEED,
    ARTICLE_STREAM_DOMAIN,
    hashStrings(qualifying.map((a) => a.id)),
  );
  const draw = new Array<number>(n);
  const medians = new Array<number>(BOOTSTRAP_RESAMPLES);
  for (let b = 0; b < BOOTSTRAP_RESAMPLES; b++) {
    for (let i = 0; i < n; i++) draw[i] = rhosByIdOrder[rng.nextIndex(n)]!;
    medians[b] = quantileType7(draw, 0.5); // §2.2: type-7 median each resample
  }
  medians.sort((a, b) => a - b);
  // §2.2 pinned percentile convention: 0-indexed floor(0.025·B), ceil(0.975·B) − 1.
  const lo = medians[Math.floor(0.025 * BOOTSTRAP_RESAMPLES)]!;
  const hi = medians[Math.ceil(0.975 * BOOTSTRAP_RESAMPLES) - 1]!;

  return {
    median: quantileType7(rhosByIdOrder, 0.5),
    q1: quantileType7(rhosByIdOrder, 0.25),
    q3: quantileType7(rhosByIdOrder, 0.75),
    ci95: [lo, hi],
    lowHeterogeneity: lo === hi,
    qualifyingArticles: n,
    publishable: n >= MIN_QUALIFYING_ARTICLES,
  };
}

/**
 * §2.1: the headline is always the full statement — median, IQR, n, and rate
 * coverage together. Below the publication threshold it states only
 * "insufficient data".
 */
export function formatPayoutRankHeadline(
  dist: PayoutRankDistribution,
  meanRateCoverage: number,
): string {
  if (!dist.publishable) {
    return `insufficient data (n = ${dist.qualifyingArticles} qualifying articles; minimum ${MIN_QUALIFYING_ARTICLES})`;
  }
  const coverage = Math.round(meanRateCoverage * 100);
  return `median ρ = ${dist.median.toFixed(2)}, IQR [${dist.q1.toFixed(2)}, ${dist.q3.toFixed(2)}], n = ${dist.qualifyingArticles} articles, rate coverage ${coverage}%`;
}

// ---------------------------------------------------------------------------
// §2.5 Gaming flag — a first-class published metric
// ---------------------------------------------------------------------------

/** The slice of ArticleMetrics the gaming flag needs. */
export interface GamingFlagInput {
  rho: number | null;
  qualifiesForPool: boolean;
  n: number;
}

/**
 * §2.5  GAMING_FLAG(p) = |{a ∈ Q_p : ρ_a > 0.99 AND n_a ≤ 5}|.
 * Short posts ranked strictly by payout are the behavior itself, not noise:
 * the flag rising is the detector working. The n ≤ 5 gate is pinned — it
 * separates manufactured short posts from long organic perfect correlations.
 */
export function gamingFlagCount(articles: readonly GamingFlagInput[]): number {
  return articles.filter(
    (a) =>
      a.qualifiesForPool &&
      a.rho !== null &&
      a.rho > GAMING_FLAG_RHO &&
      a.n <= GAMING_FLAG_MAX_N,
  ).length;
}

// ---------------------------------------------------------------------------
// §2.6 The demoted pooled correlation — warned continuity component
// ---------------------------------------------------------------------------

export interface DemotedPooledRho {
  /** ρ_p = tanh(mean(z_a)) — unweighted; dominated by extreme-ρ articles. */
  rho: number;
  z: number;
  /** The fixed published warning. Always displayed with the value. */
  warning: typeof POOLED_RHO_WARNING;
}

/**
 * §2.6: retained for continuity and third-party recomputation only. Never the
 * headline, never a Kickback input. The only place FISHER_RHO_CLAMP touches
 * a published value — and this value carries its warning for exactly that
 * kind of reason.
 */
export function demotedPooledRho(
  articles: readonly DistributionInput[],
): DemotedPooledRho | null {
  const zs: number[] = [];
  for (const a of articles) {
    if (!a.qualifiesForPool) continue;
    if (a.rho === null) {
      throw new TypeError('qualifying article has null rho; inclusion criteria were not applied');
    }
    zs.push(Math.atanh(clampRho(a.rho)));
  }
  if (zs.length === 0) return null;
  const z = zs.reduce((acc, v) => acc + v, 0) / zs.length;
  return { rho: Math.tanh(z), z, warning: POOLED_RHO_WARNING };
}

// ---------------------------------------------------------------------------
// §3 The Kickback Score
// ---------------------------------------------------------------------------

export interface KickbackInputs {
  /** R_median — the distribution median (§2.2), in [−1, 1]. NEVER pooled ρ_p. */
  medianRho: number;
  /** O — omission index (§4, not yet implemented). Null → K = 100 × R. */
  omissionIndex?: number | null;
}

export interface KickbackScore {
  /** K in [0, 100]. The convenience summary; the headline is the distribution. */
  score: number;
  components: {
    /** The raw signed median — always displayed, never hidden. */
    medianRho: number;
    /** R = max(0, R_median): a negative median is exculpatory, never punished. */
    rhoClamped: number;
    omissionIndex: number | null;
  };
  weights: typeof KICKBACK_WEIGHTS;
  /** Weights actually applied (R renormalizes to 1 when O is null). */
  effectiveWeights: { R: number; O: number | null };
  weightsVersion: string;
}

/**
 * §3  K = 100 × (0.75·R + 0.25·O), R = max(0, R_median); O null → K = 100 × R.
 * M̄, disclosure, SPP, and the gaming flag are separate published numbers,
 * never folded in. The demoted ρ_p is never an input here.
 */
export function computeKickbackScore(inputs: KickbackInputs): KickbackScore {
  const { medianRho } = inputs;
  const omissionIndex = inputs.omissionIndex ?? null;
  assertUnitInterval('medianRho', medianRho, -1, 1);
  if (omissionIndex !== null) assertUnitInterval('omissionIndex', omissionIndex);

  const rhoClamped = Math.max(0, medianRho);
  const { R, O } = KICKBACK_WEIGHTS;

  let score: number;
  let effectiveWeights: KickbackScore['effectiveWeights'];
  if (omissionIndex === null) {
    effectiveWeights = { R: 1, O: null };
    score = 100 * rhoClamped;
  } else {
    effectiveWeights = { R, O };
    score = 100 * (R * rhoClamped + O * omissionIndex);
  }

  return {
    score,
    components: { medianRho, rhoClamped, omissionIndex },
    weights: KICKBACK_WEIGHTS,
    effectiveWeights,
    weightsVersion: KICKBACK_WEIGHTS_VERSION,
  };
}

// ---------------------------------------------------------------------------
// Publisher report — orthogonal numbers, never compressed (§3)
// ---------------------------------------------------------------------------

export type PublisherStatus = 'ok' | 'insufficient_data' | 'not_scored_no_revenue';

export interface PublisherReport {
  articleCount: number;
  articles: ArticleMetrics[];
  /** Monetized: M̄. A FACT, never scored. */
  meanMonetizedRatio: number | null;
  /** §3 gate: M̄ = 0 ⟹ no conflict is possible ⟹ not scored at all. */
  takesNoAffiliateRevenue: boolean;
  /** Disclosure: article-weighted deficiency (A=0…F=1). */
  meanDisclosureDeficiency: number | null;
  /** Mean C_a across articles where defined. Published next to every score. */
  meanRateCoverage: number | null;
  /** THE HEADLINE (§2.1): median ρ_a, IQR, n, with the §2.2 bootstrap CI. */
  distribution: PayoutRankDistribution | null;
  /** §2.5: count of qualifying articles with ρ > 0.99 at n ≤ 5. */
  gamingFlagCount: number;
  /** §2.6: warned continuity component. Never the headline, never in K. */
  pooledContinuity: DemotedPooledRho | null;
  /** Articles not in Q_p. */
  excludedFromPool: number;
  /** §1.4: every exclusion count, by reason. Reasons may co-occur per article. */
  exclusionCounts: Record<ExclusionReason, number>;
  /** The convenience summary (§3): K = 100 × (0.75·max(0, R_median) + 0.25·O). */
  kickback: KickbackScore | null;
  /** §1.6: Sole-Paid-Pick Placement. Null when A₁ = ∅. */
  spp: SolePaidPlacement | null;
  status: PublisherStatus;
}

export function scorePublisher(articles: readonly ArticleInput[]): PublisherReport {
  const metrics = articles.map(computeArticleMetrics);

  // §0.2: id is the corpus primary key. A duplicate within a publisher means
  // the same article counted twice — data corruption, never scored through.
  const ids = new Set<string>();
  for (const m of metrics) {
    if (ids.has(m.id)) {
      throw new TypeError(`duplicate article id "${m.id}" — id is the corpus primary key (§0.2)`);
    }
    ids.add(m.id);
  }

  const mean = (values: number[]): number | null =>
    values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;

  const meanMonetized = mean(
    metrics.map((m) => m.monetizedRatio).filter((v): v is number => v !== null),
  );
  const meanDeficiency = mean(metrics.map((m) => m.disclosureDeficiency));
  const meanCoverage = mean(
    metrics.map((m) => m.rateCoverage).filter((v): v is number => v !== null),
  );

  // §3 gate: exactly M̄ = 0 means no conflict is structurally possible. Not
  // scored at all.
  const takesNoAffiliateRevenue = meanMonetized === 0;

  let distribution: PayoutRankDistribution | null = null;
  let flagCount = 0;
  let pooledContinuity: DemotedPooledRho | null = null;
  let spp: SolePaidPlacement | null = null;
  if (!takesNoAffiliateRevenue) {
    distribution = computePayoutRankDistribution(metrics);
    flagCount = gamingFlagCount(metrics);
    pooledContinuity = demotedPooledRho(metrics);
    spp = computeSolePaidPlacement(metrics);
  }

  const exclusionCounts: Record<ExclusionReason, number> = {
    fewer_than_2_priced_picks: 0,
    fewer_than_4_rated_picks: 0,
    rate_coverage_undefined: 0,
    rate_coverage_below_threshold: 0,
    rho_undefined: 0,
  };
  for (const m of metrics) {
    for (const reason of m.exclusionReasons) exclusionCounts[reason]++;
  }

  let status: PublisherStatus;
  let kickback: KickbackScore | null = null;
  if (takesNoAffiliateRevenue) {
    status = 'not_scored_no_revenue';
  } else if (distribution !== null && distribution.publishable) {
    status = 'ok';
    kickback = computeKickbackScore({ medianRho: distribution.median });
  } else {
    status = 'insufficient_data';
  }

  return {
    articleCount: metrics.length,
    articles: metrics,
    meanMonetizedRatio: meanMonetized,
    takesNoAffiliateRevenue,
    meanDisclosureDeficiency: meanDeficiency,
    meanRateCoverage: meanCoverage,
    distribution,
    gamingFlagCount: flagCount,
    pooledContinuity,
    excludedFromPool: metrics.length - (distribution?.qualifyingArticles ?? 0),
    exclusionCounts,
    kickback,
    spp,
    status,
  };
}
