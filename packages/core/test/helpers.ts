/**
 * Shared fixture builders for the v0.6 test suites.
 *
 * Every article carries an `id` (§0.2: SHA-256 of the canonical URL in
 * production; an opaque unique string in tests). Ids key the §2.2 bootstrap
 * stream, so fixtures take the id explicitly — corpus builders must hand out
 * unique, deterministic ids or scorePublisher throws on the duplicate key.
 *
 * Note on correlation fixtures: fixtures that exercise the distribution use
 * ρ = ±0.9 vectors (one discordant swap), plus explicit ρ = 1 fixtures for the
 * §2.5 gaming-flag populations.
 */
import type { ArticleInput, DisclosureGrade, ScoredPick } from '../src/index.js';

export function picks(rates: (number | null)[], monetized?: boolean[]): ScoredPick[] {
  return rates.map((rate, i) => ({
    position: i + 1,
    rate,
    monetized: monetized ? monetized[i]! : true,
  }));
}

export function article(
  id: string,
  rates: (number | null)[],
  grade: DisclosureGrade = 'B',
  monetized?: boolean[],
): ArticleInput {
  return { id, picks: picks(rates, monetized), disclosureGrade: grade };
}

/**
 * ρ_a = +0.9 exactly: r = [0.10, 0.08, 0.02, 0.04, 0] against s = [5,4,3,2,1]
 * (rank(r) = [5,4,2,3,1]; one discordant swap). k = 4, C = 1, n' = 5.
 */
export function suspiciousArticle(id: string, grade: DisclosureGrade = 'B'): ArticleInput {
  return article(id, [0.1, 0.08, 0.02, 0.04, null], grade, [true, true, true, true, false]);
}

/** Mirror image: ρ_a = −0.9 exactly. The exculpatory direction. */
export function honestArticle(id: string, grade: DisclosureGrade = 'A'): ArticleInput {
  return article(id, [null, 0.04, 0.02, 0.08, 0.1], grade, [false, true, true, true, true]);
}

/**
 * Heavily tied at zero: 3 priced picks on top of 7 unmonetized r = 0 picks.
 * n' = 10, k = 3, C = 1; ρ_a ≈ 0.813.
 */
export function tiedArticle(id: string, grade: DisclosureGrade = 'B'): ArticleInput {
  const rates: (number | null)[] = [0.08, 0.05, 0.03, null, null, null, null, null, null, null];
  const monetized = [true, true, true, false, false, false, false, false, false, false];
  return article(id, rates, grade, monetized);
}

/** ρ_a = 1 exactly at n = 5: the manufactured short perfect post (§2.5). */
export function monotoneArticle(id: string, grade: DisclosureGrade = 'B'): ArticleInput {
  return article(id, [0.1, 0.08, 0.06, 0.04, 0.02], grade);
}

/** ρ_a = 1 exactly at n = 6: the ORGANIC long perfect correlation (must not flag). */
export function organicMonotone6(id: string, grade: DisclosureGrade = 'B'): ArticleInput {
  return article(id, [0.11, 0.09, 0.07, 0.05, 0.03, 0.01], grade);
}

/** k_a = 1: sole priced pick at position q of n; all other picks unmonetized. */
export function soloArticle(id: string, n: number, q: number, rate = 0.05): ArticleInput {
  return {
    id,
    picks: Array.from({ length: n }, (_, i) => ({
      position: i + 1,
      rate: i + 1 === q ? rate : null,
      monetized: i + 1 === q,
    })),
    disclosureGrade: 'B',
  };
}

/** Build n fixtures with unique deterministic ids: many(3, 's', suspiciousArticle). */
export function many(
  n: number,
  prefix: string,
  make: (id: string) => ArticleInput,
): ArticleInput[] {
  return Array.from({ length: n }, (_, i) => make(`${prefix}${i}`));
}
