/**
 * @disclosed/core — deterministic affiliate-link classification and
 * Payout-Rank Correlation scoring.
 *
 * Zero runtime dependencies. Pure functions only: no I/O, no network, no
 * clock. This is the one package that must be auditable line by line.
 */

export type {
  ArticleInput,
  Classification,
  DisclosureGrade,
  Evidence,
  EvidenceKind,
  RateKind,
  ScoredPick,
  Tier,
} from './types.js';

export {
  articleIdFromUrl,
  canonicalUrl,
  isTrackingParam,
  sha256Hex,
  CANON_RULES_VERSION,
  PROTECTED_LINK_PARAMS,
  TRACKING_PARAM_PREFIXES,
  TRACKING_PARAMS,
} from './canonical.js';

export {
  publicSuffixLabelCount,
  registrableDomain,
  registrableDomainOfUrl,
  sameRegistrableDomain,
  CCTLD_SECOND_LEVEL_LABELS,
  MULTI_LABEL_PUBLIC_SUFFIXES,
} from './domain.js';

export {
  API_ORIGIN,
  BOT_PAGE,
  CONTACT_EMAIL,
  DOMAIN,
  FIREFOX_ADDON_ID,
  RETIRED_DOMAIN,
  SITE_ORIGIN,
  USER_AGENT,
} from './identity.js';

export { parseRuleset } from './ruleset.js';
export type { NetworkRule, ParamSignature, Ruleset } from './ruleset.js';

export {
  classify,
  createClassifier,
  shouldBadge,
  hasSponsoredRel,
  declaredMerchantOfUrl,
  declaredVendorOfUrl,
  declaredVendorPathSegments,
  declaredDestinationHost,
  decodeBase64Ascii,
  DECLARED_DESTINATION_REDIRECTORS,
  MATCH_CONFIDENCE,
  PUBLISHER_DECLARED_DIRECT_NETWORK,
  PUBLISHER_DECLARED_MERCHANT_PARAMS,
  PUBLISHER_DECLARED_NETWORK,
  PUBLISHER_DECLARED_VENDOR_PARAMS,
  RESOLUTION_CONFIDENCE_FACTOR,
} from './classify.js';
export type { ClassifyOptions, DeclaredDestinationRedirector, DeclaredVendor } from './classify.js';

export {
  averageRanks,
  erf,
  median,
  normalCdf,
  pearson,
  poissonBinomialUpperTail,
  quantileType7,
  sampleVariance,
  spearman,
} from './stats.js';

export {
  articleRho,
  articleRhoAtRateMax,
  bandSensitivity,
  dominantRateKind,
  effectiveRateInKind,
  effectiveRateMaxInKind,
  rateKindKey,
  rateKindMismatchCount,
  DEFAULT_RATE_KIND,
  RATE_KINDS,
  isBanded,
  isMultiMerchant,
  BAND_SENSITIVITY_SPREAD,
  computeArticleMetrics,
  computeKickbackScore,
  computePayoutRankDistribution,
  computeSolePaidPlacement,
  demotedPooledRho,
  effectiveRate,
  effectiveRateMax,
  formatPayoutRankHeadline,
  gamingFlagCount,
  monetizedRatio,
  rateCoverage,
  scorePublisher,
  topPickPremium,
  BOOTSTRAP_RESAMPLES,
  BOOTSTRAP_SEED,
  DISCLOSURE_DEFICIENCY,
  FISHER_RHO_CLAMP,
  GAMING_FLAG_MAX_N,
  GAMING_FLAG_RHO,
  KICKBACK_WEIGHTS,
  KICKBACK_WEIGHTS_VERSION,
  MIN_PRICED_PICKS,
  MIN_QUALIFYING_ARTICLES,
  MIN_RATE_COVERAGE,
  MIN_RATED_PICKS,
  MIN_SPP_ARTICLES,
  POOLED_RHO_WARNING,
  SPP_EXACT_LIMIT,
  SPP_PERMUTATIONS,
} from './scoring.js';
export type {
  ArticleMetrics,
  DemotedPooledRho,
  DominantRateKind,
  DistributionInput,
  ExclusionReason,
  GamingFlagInput,
  KickbackInputs,
  KickbackScore,
  PayoutRankDistribution,
  PublisherReport,
  PublisherStatus,
  SolePaidPlacement,
  TopPickPremium,
} from './scoring.js';
