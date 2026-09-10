/**
 * Public types for @disclosed/core.
 *
 * This package is precision-critical and must be auditable line by line.
 * Everything here is deterministic: same inputs, same outputs, no I/O.
 */

/**
 * Confidence tier for a classified URL (CLAUDE.md "Confidence tiers").
 *
 * - `confirmed`: known network domain match, or known param + known merchant
 *   pair, on a signature validated against >= 4 real observed URLs, of
 *   which exactly 3 are recorded as verified_samples and held out of its
 *   precision denominator (docs/LABELING.md §6).
 * - `likely`: cloaked path whose server-side resolution terminates at a
 *   confirmed network, a match on a signature not yet validated, or a link on
 *   the PUBLISHER'S OWN registrable domain that it ITSELF declared sponsored
 *   (docs/LABELING.md §2 rule 5, ruling 2026-09-07, amended 2026-09-07b) —
 *   which is a declaration, not a signature, and is therefore capped here and
 *   can never reach `confirmed`.
 * - `possible`: bare generic param (?ref=, ?aff=, …) with no corroboration, or
 *   a `rel="sponsored"` link to a registrable domain that is NOT the
 *   publisher's (`publisher_declared_direct`). Never badged; shown only on
 *   explicit user request.
 * - `none`: no signal.
 */
export type Tier = 'confirmed' | 'likely' | 'possible' | 'none';

export type EvidenceKind =
  | 'network_host_match'
  | 'merchant_param_match'
  | 'known_merchant_subdomain'
  | 'possible_param'
  | 'corroborating_param'
  | 'cloak_path_hint'
  | 'publisher_declared'
  | 'publisher_declared_direct'
  | 'publisher_declared_unattributable'
  | 'requires_resolution'
  | 'path_required_unmet'
  | 'unverified_signature'
  | 'resolved_destination'
  | 'invalid_url';

/**
 * A single audit-trail fact supporting (or annotating) a classification.
 * Facts only — no judgment. Every field is serializable.
 */
export interface Evidence {
  kind: EvidenceKind;
  /** Human-readable, strictly factual description of the observation. */
  detail: string;
  networkId?: string;
  host?: string;
  path?: string;
  param?: string;
  pattern?: string;
  merchant?: string;
  url?: string;
}

/** Result of classify(). */
export interface Classification {
  tier: Tier;
  /** Network id from the ruleset (e.g. "amazon_associates"), or null. */
  network: string | null;
  /**
   * Merchant, when determinable from the URL alone: a canonical merchant
   * domain (param + merchant-host pair), a mapped merchant name (known
   * merchant subdomain), or the destination host (possible tier). Null when
   * the URL only reaches a network click domain.
   */
  merchant: string | null;
  /** Deterministic confidence in [0, 1]; see MATCH_CONFIDENCE. */
  confidence: number;
  /** Every observation made while classifying, including weaker signals. */
  evidence: Evidence[];
}

/**
 * SPEC §0.1.3 (v0.6.10) — the UNIT a published rate is in.
 *
 * A rate is not a number, it is a number in a unit, and Spearman will happily
 * rank a $40 bounty against a 6% share and return a coefficient for it. This
 * type is what stops that.
 *
 * `other` covers a structure we can state but not reduce to one number; its
 * `rate` is null by construction.
 */
export type RateKind = 'percent_of_sale' | 'flat_bounty' | 'recurring_percent' | 'other';

/**
 * A ranked pick extracted from one article, as scored by the crawler.
 *
 * `rate` carries the PUBLISHED commission rate. The load-bearing r_i of
 * SPEC-scoring §0.1 is derived from (monetized, rate) — see effectiveRate():
 *   - not monetized            → r_i = 0    (a KNOWN rate: earns nothing)
 *   - monetized, rate known    → r_i = rate
 *   - monetized, rate private  → r_i = null (the only null case)
 */
export interface ScoredPick {
  /** 1 = top pick. Unique within an article. */
  position: number;
  /**
   * Published commission rate as a decimal in [0, 1], or null when the network
   * keeps it private. For an unmonetized pick this must be null or 0 — the
   * publisher earns nothing regardless.
   *
   * For a BANDED merchant (SPEC §0.1.1) this is the published MINIMUM — the
   * floor the publisher provably earns — and `rateMax` carries the ceiling.
   */
  rate: number | null;
  /**
   * Published maximum of a commission BAND (SPEC §0.1.1), or null/absent for a
   * point rate. Merchants routinely publish a range ("4–7%") because a
   * publisher's tier inside the band is negotiated privately; an Amazon
   * vertical mapping to two fee categories is treated identically.
   *
   * `rate` (the floor) is what `r_i` resolves to. This field exists so every
   * `rho_a` can be computed a second time at the ceiling — the mandatory
   * sensitivity pass. **No midpoint is ever derived from the two: an
   * interpolated rate is a number no source states, and this project publishes
   * nothing a third party cannot recompute from a cited page.**
   */
  rateMax?: number | null;
  /**
   * SPEC §0.1.2: this pick's links reach TWO OR MORE distinct merchants, so
   * the publisher earns from whichever link the reader takes.
   *
   * This is a DIFFERENT unknown from a band and is deliberately not folded
   * into one. §0.1.1 is uncertainty about one merchant's rate; this is
   * uncertainty about **which merchant applies at all**, with rate
   * uncertainty compounding on top. `rate` is the minimum across the
   * merchants and `rateMax` the maximum, so the §0.1.1 sensitivity pass
   * treats it exactly as it treats a band — but the two are COUNTED
   * SEPARATELY, because a reader is entitled to see which unknown is driving
   * a sensitivity flag.
   */
  multiMerchant?: boolean;
  /**
   * The merchants compared to produce `rate`/`rateMax` (§0.1.2). Published so
   * a third party can recompute the minimum rather than trust it.
   */
  merchants?: string[];
  /**
   * SPEC §0.1.3 — the unit `rate` is in. Absent means `percent_of_sale`,
   * which is what every rate this project held before v0.6.10 was.
   *
   * ρ_a is computed WITHIN one kind: a pick whose kind differs from its
   * article's dominant kind gets `r_i = null` with reason
   * `rate_kind_mismatch`. See `dominantRateKind()`.
   */
  rateKind?: RateKind;
  /**
   * ISO-4217-ish currency code. **REQUIRED on a `flat_bounty` and refused on
   * anything else.** USD 40 and CAD 40 are different amounts; a bounty table
   * that mixes them silently is a rate table with no unit. A percentage is
   * dimensionless and carrying a currency on one would assert otherwise.
   */
  rateCurrency?: string;
  /** True when the pick's link classified as `confirmed` or `likely`. */
  monetized: boolean;
}

/** Disclosure grade, purely positional (SPEC-scoring.md §1.5). */
export type DisclosureGrade = 'A' | 'B' | 'C' | 'D' | 'F';

export interface ArticleInput {
  /**
   * Stable article identity (SPEC §0.2): the SHA-256 of the canonical URL,
   * hex-encoded. Canonicalization (crawler's contract): scheme+host
   * lowercased, default ports and trailing slashes removed, tracking query
   * params stripped, fragment removed. Core treats the id as an opaque,
   * stable, unique key: it keys the §2.2 bootstrap stream and the
   * longitudinal corpus. Must be non-empty and unique within a publisher.
   */
  id: string;
  picks: ScoredPick[];
  disclosureGrade: DisclosureGrade;
}
