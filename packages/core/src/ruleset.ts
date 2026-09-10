/**
 * Ruleset parsing and validation (networks.json v0.2).
 *
 * The classifier is data-driven: signatures live in a rules bundle
 * (data/networks.json, shipped to the extension as data — never code).
 * Core validates the bundle strictly before using it; a malformed bundle
 * must fail loudly at load time, never silently misclassify.
 *
 * Unknown fields (rate_card, notes, markets, dom_signature, …) are ignored:
 * they belong to other packages (the crawler consumes dom_signature) and must
 * not break classification when the schema grows.
 */

import { PUBLISHER_DECLARED_DIRECT_NETWORK, PUBLISHER_DECLARED_NETWORK } from './classify.js';

export interface ParamSignature {
  /** Query parameter name (exact, case-sensitive). */
  param: string;
  /**
   * When present, the param is a PRIMARY signal only on these merchant
   * domains (the "known param + known merchant pair" rule, e.g. tag on
   * amazon.com). Subdomains of a listed domain match. This is the sole way a
   * param produces a match on a confirmed/likely-tier network — it is the only
   * primary evidence Amazon has now that amzn.to requires resolution.
   */
  on_hosts?: string[];
  /**
   * The param only counts when the URL host matches one of the network's own
   * host_patterns. Prevents a network param (?sid=, ?murl=) from firing on a
   * foreign host where it is just noise. Corroboration only — never primary.
   */
  host_required?: boolean;
  /** Never a primary signal; only corroborates an independent host match. */
  corroboration_only?: boolean;
}

export interface NetworkRule {
  id: string;
  name: string;
  /**
   * True only after the signature has been validated against >= 3 real
   * observed URLs (CLAUDE.md). While false, matches are capped at `likely`.
   */
  verified: boolean;
  /** Tier a match yields, before the verification cap. */
  tier_on_match: 'confirmed' | 'likely' | 'possible';
  /**
   * Host patterns. Exact ("anrdoezrs.net") or subdomain wildcard ("*.pxf.io",
   * which matches subdomains but not the apex). A leading "www." on the
   * observed host is ignored during matching. May be empty (Amazon has no
   * host pattern in v0.2 — see requires_resolution).
   */
  host_patterns?: string[];
  /**
   * Host patterns added to this entry on observed evidence but NOT YET
   * confirmed under docs/LABELING.md §6.
   *
   * They match exactly as `host_patterns` do, under the same path constraint,
   * but a match against one is CAPPED AT `likely` even when the entry itself
   * carries `verified: true` — with an `unverified_signature` evidence entry
   * naming the pattern. `verified` is a property of an entry, and an entry
   * that is right about five hosts has said nothing about a sixth. Letting a
   * new pattern inherit the old one's verification is exactly how a
   * `confirmed` badge ships on a host nobody ever confirmed.
   *
   * Promotion moves a pattern into `host_patterns` and records its own
   * `verified_samples` under `host_pattern_promotions` — the entry's existing
   * hold-out is never overwritten or extended (crawler: labeling.ts).
   */
  unverified_host_patterns?: string[];
  /**
   * Hosts that are NOT evidence on their own and must be resolved server-side
   * before classification (e.g. amzn.to, an official shortener also used for
   * non-affiliate links). A bare match here yields `none` with a
   * `requires_resolution` evidence hint; the destination is classified via
   * ClassifyOptions.resolvedUrl.
   */
  requires_resolution?: string[];
  /**
   * Path constraints. When present (or when path_required is true), a host
   * match additionally requires the URL path to equal one of these (or extend
   * it past a "/").
   */
  path_patterns?: string[];
  /**
   * v0.2: the path constraint is MANDATORY. Set on hosts that are BOTH a
   * corporate site and a tracking host (shareasale.com, avantlink.com,
   * awin1.com). A host-only match against such an entry must classify as
   * `none` — classifying shareasale.com/about as affiliate is the exact
   * failure mode CLAUDE.md forbids.
   */
  path_required?: boolean;
  param_signatures?: ParamSignature[];
  /** Exact host -> merchant display name (e.g. goto.walmart.com -> Walmart). */
  known_merchant_subdomains?: Record<string, string>;
}

export interface Ruleset {
  version?: string;
  networks: NetworkRule[];
  cloak_path_hints?: { patterns: string[] };
}

function fail(path: string, expected: string): never {
  throw new Error(`invalid ruleset: ${path} must be ${expected}`);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function requireString(v: unknown, path: string): string {
  if (typeof v !== 'string' || v.length === 0) fail(path, 'a non-empty string');
  return v;
}

function optionalStringArray(v: unknown, path: string): string[] | undefined {
  if (v === undefined) return undefined;
  if (!Array.isArray(v)) fail(path, 'an array of strings');
  return v.map((s, i) => requireString(s, `${path}[${i}]`));
}

function optionalBoolean(v: unknown, path: string): boolean | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== 'boolean') fail(path, 'a boolean');
  return v;
}

const TIERS_ON_MATCH = ['confirmed', 'likely', 'possible'] as const;

function parseParamSignature(v: unknown, path: string): ParamSignature {
  if (!isRecord(v)) fail(path, 'an object');
  const sig: ParamSignature = { param: requireString(v.param, `${path}.param`) };
  const on_hosts = optionalStringArray(v.on_hosts, `${path}.on_hosts`);
  if (on_hosts) sig.on_hosts = on_hosts;
  const hostRequired = optionalBoolean(v.host_required, `${path}.host_required`);
  if (hostRequired !== undefined) sig.host_required = hostRequired;
  const corroborationOnly = optionalBoolean(v.corroboration_only, `${path}.corroboration_only`);
  if (corroborationOnly !== undefined) sig.corroboration_only = corroborationOnly;
  return sig;
}

function parseNetwork(v: unknown, path: string): NetworkRule {
  if (!isRecord(v)) fail(path, 'an object');
  const id = requireString(v.id, `${path}.id`);
  const name = requireString(v.name, `${path}.name`);
  if (typeof v.verified !== 'boolean') fail(`${path}.verified`, 'a boolean');
  const tier = v.tier_on_match;
  if (typeof tier !== 'string' || !(TIERS_ON_MATCH as readonly string[]).includes(tier)) {
    fail(`${path}.tier_on_match`, `one of ${TIERS_ON_MATCH.join(', ')}`);
  }

  const rule: NetworkRule = {
    id,
    name,
    verified: v.verified,
    tier_on_match: tier as NetworkRule['tier_on_match'],
  };

  const hosts = optionalStringArray(v.host_patterns, `${path}.host_patterns`);
  if (hosts) rule.host_patterns = hosts;
  const unverifiedHosts = optionalStringArray(
    v.unverified_host_patterns,
    `${path}.unverified_host_patterns`,
  );
  if (unverifiedHosts) rule.unverified_host_patterns = unverifiedHosts;
  const requiresResolution = optionalStringArray(v.requires_resolution, `${path}.requires_resolution`);
  if (requiresResolution) rule.requires_resolution = requiresResolution;
  const paths = optionalStringArray(v.path_patterns, `${path}.path_patterns`);
  if (paths) rule.path_patterns = paths;

  const pathRequired = optionalBoolean(v.path_required, `${path}.path_required`);
  if (pathRequired !== undefined) rule.path_required = pathRequired;
  // A required path constraint with no patterns to satisfy can never match and
  // is almost certainly an authoring error. Fail loudly rather than silently
  // dropping the entry.
  if (rule.path_required && (rule.path_patterns?.length ?? 0) === 0) {
    fail(`${path}.path_patterns`, 'non-empty when path_required is true');
  }

  if (v.param_signatures !== undefined) {
    if (!Array.isArray(v.param_signatures)) fail(`${path}.param_signatures`, 'an array');
    rule.param_signatures = v.param_signatures.map((s, i) =>
      parseParamSignature(s, `${path}.param_signatures[${i}]`),
    );
  }

  if (v.known_merchant_subdomains !== undefined) {
    if (!isRecord(v.known_merchant_subdomains)) {
      fail(`${path}.known_merchant_subdomains`, 'an object of host -> merchant name');
    }
    const map: Record<string, string> = {};
    for (const [host, merchant] of Object.entries(v.known_merchant_subdomains)) {
      map[host] = requireString(merchant, `${path}.known_merchant_subdomains["${host}"]`);
    }
    rule.known_merchant_subdomains = map;
  }

  return rule;
}

/**
 * Validate an untrusted rules bundle. Throws with a precise path on the first
 * violation. Extra fields are ignored.
 */
export function parseRuleset(json: unknown): Ruleset {
  if (!isRecord(json)) fail('ruleset', 'an object');
  if (!Array.isArray(json.networks) || json.networks.length === 0) {
    fail('ruleset.networks', 'a non-empty array');
  }

  const ruleset: Ruleset = {
    networks: json.networks.map((n, i) => parseNetwork(n, `networks[${i}]`)),
  };

  if (typeof json.version === 'string') ruleset.version = json.version;

  if (json.cloak_path_hints !== undefined) {
    if (!isRecord(json.cloak_path_hints)) fail('ruleset.cloak_path_hints', 'an object');
    const patterns = optionalStringArray(
      json.cloak_path_hints.patterns,
      'ruleset.cloak_path_hints.patterns',
    );
    if (!patterns) fail('ruleset.cloak_path_hints.patterns', 'an array of strings');
    ruleset.cloak_path_hints = { patterns };
  }

  const seen = new Set<string>();
  for (const n of ruleset.networks) {
    if (seen.has(n.id)) fail(`networks id "${n.id}"`, 'unique');
    // Both reserved ids are what classify() emits for a link the PUBLISHER
    // declared sponsored — on its own domain (`publisher_cloak`, capped at
    // `likely` forever) and on someone else's (`publisher_declared_direct`,
    // `possible` and never badged). A signature claiming either id could
    // carry verified: true and would silently promote declarations into a
    // tier no declaration may reach.
    if (n.id === PUBLISHER_DECLARED_NETWORK || n.id === PUBLISHER_DECLARED_DIRECT_NETWORK) {
      fail(`networks id "${n.id}"`, `anything but the reserved ids "${PUBLISHER_DECLARED_NETWORK}" and "${PUBLISHER_DECLARED_DIRECT_NETWORK}"`);
    }
    seen.add(n.id);
  }

  return ruleset;
}
