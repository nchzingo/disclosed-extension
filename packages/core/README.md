# @disclosed/core

Deterministic affiliate-link classification and Payout-Rank Correlation scoring.
Implements **networks.json v0.2** and **SPEC-scoring.md v0.6.1** (frozen scoring surface).

- **Zero runtime dependencies.** `tsconfig.build.json` compiles with `types: []`, so any
  Node/DOM-only API leaking into `src/` fails the build. Pure functions: no I/O, no network,
  no clock, no randomness.
- **TypeScript strict** with `noUncheckedIndexedAccess`.
- **Tests were written before the implementation** (see git history). Every expected value in
  `test/scoring.test.ts` was hand-computed from the formulas in `SPEC-scoring.md`.

## classify(url, ruleset, opts?)

Data-driven: signatures come from a rules bundle (`data/networks.json`) validated by
`parseRuleset()`. Returns `{ tier, network, merchant, confidence, evidence }`.

Deliberate decisions, all serving *precision over recall* (CLAUDE.md rule 3):

| Decision | Rationale |
|---|---|
| Unverified signatures are capped at `likely`, never `confirmed` | A signature is not promoted to `confirmed` until validated against ≥ 3 real observed URLs (`verified: true`). The cap is recorded as `unverified_signature` evidence. The v0.2 seed is entirely unverified, so nothing classifies as `confirmed` yet. |
| **v0.2** — `path_required` entries need their tracking path; a host-only match returns `none` | `shareasale.com`, `avantlink.com`, `awin1.com` are corporate sites that also host click paths. `shareasale.com/about` is not an affiliate link; classifying it as one is the exact failure mode CLAUDE.md forbids. |
| **v0.2** — `requires_resolution` hosts (`amzn.to`) return `none` until resolved | `amzn.to` is Amazon's official shortener, used for non-affiliate links too. It is not evidence alone; the destination is classified via `opts.resolvedUrl`, and only then (if it lands on an Amazon `tag` link) is it `likely`. |
| On confirmed/likely networks only an `on_hosts` param is primary (`amazon.com?tag=`) | Host-scoped params (`?sid=`, `?irclickid=`, `?murl=`) only corroborate a host match; they never fire standalone. `?sid=` is session-id noise on half the web. |
| Params on `possible`-tier networks (`?ref=`, `?rfsn=`, …) yield `possible` at most | `possible` is never badged (`shouldBadge()` encodes this). |
| Cloak paths (`/go/`, `/recommends/`, …) are hints, not evidence: tier `none` | Resolve via `opts.resolvedUrl`; termination at a confirmed network yields `likely`. |
| Confidence is a published lookup table (`MATCH_CONFIDENCE`), resolution scaled by `RESOLUTION_CONFIDENCE_FACTOR` | No opaque scoring. Same input, same output, auditable. |
| Invalid/non-http(s) URLs return `none` and never throw | The classifier runs on arbitrary page content. |

`dom_signature` (Skimlinks/Sovrn client-side rewrite detection) is intentionally **not**
handled here — it needs a rendered DOM, which is the crawler's job. `parseRuleset()` ignores it.

## Scoring (SPEC-scoring.md v0.6.1 §1–§3)

The load-bearing r_i of §0.1 is derived by `effectiveRate(pick)`:

| Pick | r_i |
|---|---|
| not monetized | **0** — a *known* rate (earns nothing); enters the correlation |
| monetized, rate published | the rate |
| monetized, rate private | `null` — the only null case; excluded from ρ |

- **Unmonetized picks enter ρ at 0** (the v0.2 correctness fix). A contradictory input
  (unmonetized pick with a positive rate) throws.
- **`C_a` is monetized-constrained** (§1.2): `k_a` priced picks over monetized picks.
- **Q_p inclusion (§1.4, all three):** `k_a ≥ 2` priced picks, `n' ≥ 4` determined rates,
  `C_a ≥ 0.60`. `k_a = 1` articles route to SPP. Exclusions are recorded **by reason** in
  `PublisherReport.exclusionCounts`.

### §2 — the headline is the distribution, not a pooled scalar (v0.5)

The v0.2–v0.4 pooled-scalar apparatus (inverse-variance weights, within-article bootstrap,
variance floor) is **deleted**. Pooling is a sum over articles, and any weighted sum is movable
by contributing summands — adversarially or by an ordinary skewed honest corpus (the v0.4
estimator scored an honest publisher `ρ_p = 0.9999, K = 99.99` off one organic long ρ = 1
article). Order statistics do not sum.

- **Article `id` (§0.2, v0.6)** — every `ArticleInput` carries `id`: the SHA-256 of the
  canonical URL (crawler's contract; core treats it as an opaque, stable, unique key). An empty
  id or a duplicate id within a publisher throws — it is the corpus primary key.
- **`computePayoutRankDistribution()` (§2.1/§2.2)** — median ρ_a, IQR [Q1, Q3] (type-7
  quantiles — canonical per §2.1), n over Q_p, plus an **article-set bootstrap CI** of the
  median: B = 2000 resamples of the article set (never within articles), published RNG
  ([src/random.ts](src/random.ts): xorshift128, seed `0xD15C105E`), **stream keyed to the sorted
  article-`id` set** (§0.2/v0.6) so the CI is crawl-order-independent AND publisher-specific —
  two publishers sharing a ρ_a multiset draw distinct streams. CI bounds at the pinned §2.2
  order statistics `⌊0.025·B⌋` / `⌈0.975·B⌉ − 1`. Publication threshold n ≥ 20.
- **Zero-width CI = `lowHeterogeneity: true` (§2.2)** — clustered ρ_a makes order-statistic
  resamples degenerate. It is labeled low article heterogeneity and must never be read as
  precision. The 50% breakdown of the median is disclosed (§2.3): past half contamination the
  median saturates honestly; the IQR and the gaming flag keep the composition visible.
- **`gamingFlagCount()` (§2.5)** — `|{a ∈ Q_p : ρ_a > 0.99 ∧ n_a ≤ 5}|`, first-class published
  metric. The `n ≤ 5` gate is pinned: a 5-pick ρ = 1 post flags; an organic ρ = 1 at n ≥ 6 does
  not (both regression-tested).
- **`demotedPooledRho()` (§2.6)** — unweighted mean of clamped z, retained for continuity only,
  always carrying `POOLED_RHO_WARNING`. `FISHER_RHO_CLAMP` touches nothing else: every headline
  value is recomputable from the raw ρ_a list with plain order statistics (asserted in tests),
  mooting both v0.4 incoherences.
- **The §2.4 falsification record is a first-class test** (`test/inference.test.ts`): across
  `{21×ρ0.9 +1}`, `{+5}`, `{+50}` the median moves 0.90 → 0.90 → 1.00, the median CI never
  collapses around a contaminated value while a clean majority exists, the flag rises
  1 → 5 → 50, and K holds 90 under +1/+5 summand injection.

### Spec-conformance notes (v0.6.1)

The v0.5 implementer choices are **canonical text**: type-7 quantiles (§2.1), the CI percentile
index convention (§2.2), the deleted `>0.99` display rule — implementation matches the ratified
wording with no drift. The §2.2 stream is keyed to the sorted article-`id` set (§0.2), which
**changed the CI bytes** in v0.6 as the changelog intends. `POOLED_RHO_WARNING` is byte-exact
against the de-versioned v0.6.1 text (asserted as a literal in tests).

The §1.6 SPP-mean permutation stream is **multiset-keyed by design** (§1.6, v0.6.1): a
permutation p-value is a function of the `(n_a, q_a)` multiset under the null, so
identical-multiset publishers correctly obtain identical p-values. The asymmetry with §2.2's
id-keyed stream is deliberate and canonical, not drift.

### §1.6 Sole-Paid-Pick Placement

`computeSolePaidPlacement()` over the `k_a = 1` articles: exact Poisson-binomial upper-tail
p-value for the count of sole paid picks at rank #1 (`|A₁| ≤ 500`; normal approximation above),
plus SPP-mean (permutation, published RNG, `(m+1)/(B+1)`). Publication threshold `|A₁| ≥ 20`.
**Never folded into K or ρ.** Its `k = 1` population is disjoint by construction from the gaming
flag's `k ≥ 2` population (asserted in tests).

### The report card — orthogonal numbers, never compressed (§3)

`scorePublisher()` returns them separately:

1. **Monetized** — `meanMonetizedRatio` (M̄). A fact, never scored.
2. **Disclosure** — `meanDisclosureDeficiency` (A = 0 … F = 1, article-weighted).
3. **Payout–Rank** — `distribution` (median, IQR, n, CI). **The headline.**
4. **Kickback Score** — `K = 100 × (0.75·R + 0.25·O)`, `R = max(0, R_median)` — the
   distribution median, never the pooled scalar. Omission index (§4) not implemented;
   `O` null → `K = 100 × R`.
5. **Gaming flag** — `gamingFlagCount`.
6. **Sole-Paid Placement** — `spp`, independently publishable.
7. **Pooled continuity** — `pooledContinuity`, warned, never load-bearing.

**Gate:** `M̄ = 0` ⟹ not scored (`status: 'not_scored_no_revenue'`).

A negative median clamps to 0 in `R` (exculpatory, never punished); the signed median stays in
`components.medianRho` and the distribution. Malformed input throws instead of mis-scoring.
