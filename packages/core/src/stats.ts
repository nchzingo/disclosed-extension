/**
 * Statistics primitives. Hand-rolled because core has zero runtime
 * dependencies and every formula must be auditable line by line.
 */

/** Median of a non-empty array (average of the two middle values when even). */
export function median(values: readonly number[]): number {
  if (values.length === 0) throw new TypeError('median: empty input');
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Ranks (1-based, ascending) with ties assigned the average of the ranks they
 * span — the standard treatment for Spearman with tied values.
 */
export function averageRanks(values: readonly number[]): number[] {
  const order = values.map((value, index) => ({ value, index }));
  order.sort((a, b) => a.value - b.value);
  const ranks = new Array<number>(values.length);
  let start = 0;
  while (start < order.length) {
    let end = start;
    while (end + 1 < order.length && order[end + 1]!.value === order[start]!.value) end++;
    const rank = (start + end) / 2 + 1;
    for (let i = start; i <= end; i++) ranks[order[i]!.index] = rank;
    start = end + 1;
  }
  return ranks;
}

/**
 * Pearson correlation. Returns null when either variable has zero variance
 * (the correlation is undefined — never fabricate a number).
 */
export function pearson(x: readonly number[], y: readonly number[]): number | null {
  if (x.length !== y.length) throw new TypeError('pearson: length mismatch');
  const n = x.length;
  if (n < 2) return null;
  let meanX = 0;
  let meanY = 0;
  for (let i = 0; i < n; i++) {
    meanX += x[i]!;
    meanY += y[i]!;
  }
  meanX /= n;
  meanY /= n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i]! - meanX;
    const dy = y[i]! - meanY;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}

/**
 * Spearman rank correlation: Pearson over average ranks. Null when undefined
 * (fewer than 2 pairs, or a variable with all-tied values).
 */
export function spearman(x: readonly number[], y: readonly number[]): number | null {
  if (x.length !== y.length) throw new TypeError('spearman: length mismatch');
  if (x.length < 2) return null;
  return pearson(averageRanks(x), averageRanks(y));
}

/**
 * Type-7 quantile (linear interpolation between order statistics — the
 * default of R and NumPy). The published method for the §2.1 IQR.
 */
export function quantileType7(values: readonly number[], p: number): number {
  if (values.length === 0) throw new TypeError('quantileType7: empty input');
  if (!(p >= 0 && p <= 1)) throw new TypeError(`quantileType7: p must be in [0, 1], got ${p}`);
  const sorted = [...values].sort((a, b) => a - b);
  const h = (sorted.length - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.min(lo + 1, sorted.length - 1);
  return sorted[lo]! + (h - lo) * (sorted[hi]! - sorted[lo]!);
}

/** Sample variance with the (m − 1) divisor. Throws below 2 observations. */
export function sampleVariance(xs: readonly number[]): number {
  const m = xs.length;
  if (m < 2) throw new TypeError('sampleVariance: need at least 2 observations');
  let mean = 0;
  for (const x of xs) mean += x;
  mean /= m;
  let ss = 0;
  for (const x of xs) {
    const d = x - mean;
    ss += d * d;
  }
  return ss / (m - 1);
}

/**
 * Error function via Abramowitz & Stegun 7.1.26 (rational approximation,
 * |error| ≤ 1.5e-7). Constants are the published A&S values; good enough for
 * a reported p-value and fully auditable.
 */
export function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const poly =
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
    t;
  return sign * (1 - poly * Math.exp(-ax * ax));
}

/** Standard normal CDF: Φ(z) = (1 + erf(z / √2)) / 2. */
export function normalCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

/**
 * Exact upper tail P(X ≥ s) of a Poisson-binomial distribution with success
 * probabilities `ps`, via the standard O(n²) convolution. Used by §1.6 SPP-1
 * for |A₁| ≤ SPP_EXACT_LIMIT.
 */
export function poissonBinomialUpperTail(ps: readonly number[], s: number): number {
  const n = ps.length;
  for (const p of ps) {
    if (!Number.isFinite(p) || p < 0 || p > 1) {
      throw new TypeError(`poissonBinomialUpperTail: probability out of range: ${p}`);
    }
  }
  if (s <= 0) return 1;
  if (s > n) return 0;
  // pmf[k] = P(X = k) over the first `seen` probabilities
  const pmf = new Array<number>(n + 1).fill(0);
  pmf[0] = 1;
  let seen = 0;
  for (const p of ps) {
    seen++;
    for (let k = seen; k >= 1; k--) pmf[k] = pmf[k]! * (1 - p) + pmf[k - 1]! * p;
    pmf[0] = pmf[0]! * (1 - p);
  }
  let tail = 0;
  for (let k = s; k <= n; k++) tail += pmf[k]!;
  return Math.min(1, tail);
}
