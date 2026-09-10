/**
 * classify(url) — deterministic affiliate-link classification (networks.json v0.2).
 *
 * Precision over recall, always (CLAUDE.md rule 3): a missed detection costs
 * nothing; one false accusation is brand-ending. Every branch that could flag
 * a link errs on the side of `none`.
 *
 * Never touches, rewrites, or fires a link (rule 1): this is a pure function
 * from a URL string to a classification. Server-side redirect resolution is
 * performed elsewhere and passed in as data via `opts.resolvedUrl`.
 *
 * v0.2 rules encoded here:
 *  - A bare corporate domain is never a signature: entries whose host is both
 *    corporate and a tracking host carry `path_required`, and a host-only match
 *    against them returns `none`.
 *  - `requires_resolution` hosts (amzn.to) are not evidence alone; they yield
 *    `none` + a hint and are classified via resolution.
 *  - On confirmed/likely networks, only an `on_hosts` param is primary; all
 *    other params corroborate a host match and never fire standalone.
 *
 * PUBLISHER DECLARATION (ruling 2026-09-07, docs/LABELING.md §2 rule 5,
 * AMENDED 2026-09-07b): a link carrying `rel="sponsored"` is the publisher's
 * own statement, in its own markup, that the link is paid placement. That is
 * a declaration by the party being paid — not a signature we inferred.
 *
 * The declaration is keyed on the DOMAIN, not on a path pattern. What the
 * declaration establishes depends on where the link goes:
 *
 *  - to the publisher's OWN registrable domain (eTLD+1 equal to the source
 *    article's) → `likely` under the reserved id `publisher_cloak`. The
 *    publisher is redirecting its own reader through its own infrastructure
 *    and has said that hop is paid. It CAN NEVER REACH `confirmed`.
 *  - to a DIFFERENT registrable domain → `possible` under the reserved id
 *    `publisher_declared_direct`. NEVER badged. The publisher has said the
 *    placement is paid, but no affiliate mechanism was detected on the link
 *    itself, and `rel="sponsored"` is also the correct attribute for paid
 *    placement that pays no commission at all. The count is published as a
 *    card fact rather than folded into monetization.
 *
 * `rel` and the source article URL are properties of the anchor on the page,
 * not of the URL, so both arrive through ClassifyOptions and are never read
 * off the destination of a resolution. Without BOTH the rule cannot fire.
 */
import { registrableDomain } from './domain.js';
import type { NetworkRule, ParamSignature, Ruleset } from './ruleset.js';
import type { Classification, Evidence, Tier } from './types.js';

/**
 * Deterministic confidence per (effective tier, match kind). Published so the
 * mapping is auditable; classification never produces any other values.
 */
export const MATCH_CONFIDENCE = {
  confirmed_host: 0.95,
  confirmed_param: 0.9,
  likely_host: 0.7,
  likely_param: 0.65,
  possible_host: 0.3,
  possible_param: 0.25,
  /**
   * A publisher's own `rel="sponsored"` declaration on its own registrable
   * domain. Equal to `likely_host` deliberately: it is one host-shaped
   * observation of the same strength — enough to badge, never enough to
   * confirm.
   */
  likely_declared: 0.7,
  /**
   * The same declaration pointing at SOMEONE ELSE'S domain. Equal to
   * `possible_host`: the publisher said the placement is paid and we detected
   * no mechanism, which is not enough to badge anyone with anything.
   */
  possible_declared: 0.3,
} as const;

/**
 * A resolution-derived classification inherits the destination's confidence
 * scaled by this factor (one redirect hop of extra uncertainty).
 */
export const RESOLUTION_CONFIDENCE_FACTOR = 0.9;

/**
 * Reserved network id for a link the PUBLISHER declared sponsored on a
 * cloaked path. Not a network and never an entry in networks.json —
 * parseRuleset() refuses a signature that tries to claim this id. It names
 * what was observed: the publisher's own cloak, declared by the publisher.
 */
export const PUBLISHER_DECLARED_NETWORK = 'publisher_cloak';

/**
 * Reserved network id for a link the PUBLISHER declared sponsored that leaves
 * the publisher's own registrable domain. Also never an entry in
 * networks.json. It classifies `possible` and is therefore NEVER badged: it
 * records that the publisher marked a direct merchant link as paid placement
 * while no affiliate mechanism was detected on the link. Published as a
 * count, never as monetization.
 */
export const PUBLISHER_DECLARED_DIRECT_NETWORK = 'publisher_declared_direct';

/**
 * Query parameters in which a publisher's cloak DECLARES its merchant.
 *
 * EXACTLY this list, grown only by ratified amendment on observed evidence —
 * never from recall, and never widened to "anything that looks like a
 * merchant". Census over the 1,066 distinct sponsored-cloak URLs in the
 * corpus (2026-09-07): `merchant` on 918, and no other param names a
 * merchant on any of the rest.
 *
 * A declared merchant is a STRING THE PUBLISHER WROTE, which may be a name
 * ("Amazon") or an opaque id. It is reported as observed and is never
 * resolved, normalised or looked up here.
 */
export const PUBLISHER_DECLARED_MERCHANT_PARAMS = ['merchant'] as const;

/**
 * Query parameters in which a publisher's own link declares the VENDOR being
 * paid — ruling 2026-09-08c, widening ruling 2026-09-07c.
 *
 * `merchant` is FIRST and therefore wins: it names its own contents, and
 * nothing about its reading changes.
 *
 * The other three are generic parameter names. `name=` in particular is one
 * of the most generic there is, and 2026-09-07c refused it on exactly that
 * ground — admitting it would admit it everywhere. **What makes it safe is
 * the guard the ruling attaches, and the guard does not live here:** a value
 * read out of one of these parameters is a rate key ONLY where it maps to a
 * merchant we already hold a rate card for. An unmapped value resolves to
 * nothing and prices nothing. This function reports what the publisher wrote;
 * `declaredMerchantRateHost` in the crawler's rate layer decides whether it
 * names anyone we know.
 *
 * IT MOVES NO TIER AND NO BADGE. A vendor parameter is not a signature, is
 * not evidence of payment, and cannot raise or lower a classification: the
 * link it sits on was already badged, or was already not, on other grounds.
 * It supplies a rate KEY. HARD RULE 2 is untouched — every rate still comes
 * from `data/rates/*` with its own `source_url` and `fetched_at`.
 */
export const PUBLISHER_DECLARED_VENDOR_PARAMS = ['merchant', 'name', 'brand', 'vendor'] as const;

/** A vendor name a publisher wrote into its own URL, and the parameter it wrote it in. */
export interface DeclaredVendor {
  param: string;
  value: string;
}

/**
 * `rel` is a space-separated token list; some publishers emit it
 * comma-separated. Tokens are matched EXACTLY and case-insensitively, so
 * `rel="sponsoredcontent"` is not a declaration.
 */
export function hasSponsoredRel(rel: string | null | undefined): boolean {
  if (typeof rel !== 'string') return false;
  return rel
    .toLowerCase()
    .split(/[\s,]+/)
    .some((token) => token === 'sponsored');
}

const TIER_RANK: Record<Tier, number> = { confirmed: 3, likely: 2, possible: 1, none: 0 };

/** Badging rule: `possible` and `none` are NEVER badged (CLAUDE.md tiers). */
export function shouldBadge(tier: Tier): boolean {
  return tier === 'confirmed' || tier === 'likely';
}

export interface ClassifyOptions {
  /**
   * Final destination from server-side, cookieless redirect resolution.
   * A cloaked or requires-resolution link that terminates at a confirmed
   * network classifies as `likely`. The user's browser never performs this
   * resolution.
   */
  resolvedUrl?: string;
  /**
   * The `rel` attribute of the anchor this URL was published on, verbatim.
   * A page-level fact the crawler observed, never derived from the URL.
   * Its ONLY effect is the publisher-declaration rule above; absent, that
   * rule cannot fire at all.
   */
  rel?: string | null;
  /**
   * The URL of the article this anchor was published ON. The other half of
   * the publisher-declaration rule: `rel="sponsored"` says the placement is
   * paid, and this says whose domain it points at. Also page-level, also
   * observed, and — like `rel` — the rule cannot fire without it, so a URL
   * classified with no source article is never badged by a declaration.
   */
  sourceUrl?: string | null;
}

interface Candidate {
  networkId: string;
  tier: Tier;
  confidence: number;
  merchant: string | null;
}

function parseHttpUrl(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
}

/** Both forms of the observed host we match against: as-is and www-stripped. */
function hostVariants(hostname: string): string[] {
  return hostname.startsWith('www.') ? [hostname, hostname.slice(4)] : [hostname];
}

/**
 * Exact patterns match exactly; "*.example.com" matches subdomains of
 * example.com but never the apex. The data lists both forms explicitly when
 * both are intended.
 */
function hostMatchesPattern(hosts: string[], pattern: string): boolean {
  const p = pattern.toLowerCase();
  if (p.startsWith('*.')) {
    const suffix = p.slice(1); // ".example.com"
    return hosts.some((h) => h.endsWith(suffix) && h !== p.slice(2));
  }
  return hosts.includes(p);
}

/** Merchant domains in on_hosts match the domain itself and any subdomain. */
function hostMatchesMerchantDomain(hostname: string, domain: string): string | null {
  const d = domain.toLowerCase();
  return hostname === d || hostname.endsWith(`.${d}`) ? domain : null;
}

function pathMatchesPattern(path: string, pattern: string): boolean {
  const p = pattern.toLowerCase();
  return path === p || path.startsWith(`${p}/`);
}

function paramPresent(params: URLSearchParams, name: string): boolean {
  return params.getAll(name).some((v) => v !== '');
}

/** True when this param can act as a standalone primary signal on this network. */
function isPrimaryParam(rule: NetworkRule, sig: ParamSignature): boolean {
  // Only the known param + known merchant pair (on_hosts) is primary on a
  // confirmed/likely network. Everything else corroborates a host match.
  if (sig.on_hosts) return true;
  // On a possible-tier network a bare generic param is the (never-badged)
  // primary signal, provided it is not explicitly corroboration-only.
  return rule.tier_on_match === 'possible' && !sig.corroboration_only && !sig.host_required;
}

/**
 * Cap for unvalidated signatures: never `confirmed` until verified
 * (CLAUDE.md). `unverifiedPattern` caps a single host pattern on an entry
 * that is otherwise verified — an entry verified against five hosts has said
 * nothing about a sixth.
 */
function effectiveTier(
  rule: NetworkRule,
  unverifiedPattern: string | null,
): { tier: Exclude<Tier, 'none'>; capped: boolean } {
  if (rule.tier_on_match === 'confirmed' && (!rule.verified || unverifiedPattern !== null)) {
    return { tier: 'likely', capped: true };
  }
  return { tier: rule.tier_on_match, capped: false };
}

function round4(x: number): number {
  return Math.round(x * 1e4) / 1e4;
}

function matchNetwork(
  rule: NetworkRule,
  url: URL,
  hosts: string[],
  evidence: Evidence[],
): Candidate | null {
  // requires_resolution: this host is not evidence on its own. Record the hint
  // and produce no direct candidate; the destination is classified via
  // opts.resolvedUrl in the resolution flow.
  const rrPattern = (rule.requires_resolution ?? []).find((p) => hostMatchesPattern(hosts, p));
  if (rrPattern) {
    evidence.push({
      kind: 'requires_resolution',
      detail: `host "${url.hostname}" matches ${rule.name} pattern "${rrPattern}" but is not evidence alone; needs server-side resolution`,
      networkId: rule.id,
      host: url.hostname,
      pattern: rrPattern,
    });
    return null;
  }

  const path = url.pathname.toLowerCase();
  const localEvidence: Evidence[] = [];
  let merchant: string | null = null;
  let hostPrimary = false;
  let paramPrimary = false;

  // A VERIFIED pattern is preferred over an unverified one when both match,
  // so an entry never loses a tier it has actually earned.
  const hostPattern = (rule.host_patterns ?? []).find((p) => hostMatchesPattern(hosts, p));
  const unverifiedPattern =
    hostPattern === undefined
      ? ((rule.unverified_host_patterns ?? []).find((p) => hostMatchesPattern(hosts, p)) ?? null)
      : null;
  const matchedPattern = hostPattern ?? unverifiedPattern;
  if (matchedPattern) {
    const pathPatterns = rule.path_patterns ?? [];
    // v0.2: path_required makes the path mandatory. Any entry that ships path
    // patterns is treated as requiring one to match, so a corporate-domain
    // host match without its tracking path is not a signature. An unverified
    // pattern is held to the SAME constraint — it is not a looser rule, only
    // a less established one.
    const pathConstraint = rule.path_required === true || pathPatterns.length > 0;
    const pathOk = !pathConstraint || pathPatterns.some((p) => pathMatchesPattern(path, p));
    if (pathOk) {
      hostPrimary = true;
      localEvidence.push({
        kind: 'network_host_match',
        detail:
          `host "${url.hostname}" matches ${rule.name} pattern "${matchedPattern}"` +
          (unverifiedPattern !== null ? ' (pattern NOT YET CONFIRMED — docs/LABELING.md §6)' : ''),
        networkId: rule.id,
        host: url.hostname,
        pattern: matchedPattern,
      });
    } else {
      localEvidence.push({
        kind: 'path_required_unmet',
        detail: `host "${url.hostname}" matches ${rule.name} but its required path constraint is unmet; not classified`,
        networkId: rule.id,
        host: url.hostname,
        path: url.pathname,
      });
    }
  }

  for (const [sub, name] of Object.entries(rule.known_merchant_subdomains ?? {})) {
    if (hosts.includes(sub.toLowerCase())) {
      hostPrimary = true;
      merchant = name;
      localEvidence.push({
        kind: 'known_merchant_subdomain',
        detail: `host "${url.hostname}" is a known ${rule.name} merchant subdomain for ${name}`,
        networkId: rule.id,
        host: url.hostname,
        merchant: name,
      });
    }
  }

  for (const sig of rule.param_signatures ?? []) {
    if (!isPrimaryParam(rule, sig)) continue;
    if (sig.on_hosts) {
      // Known param + known merchant pair (e.g. amazon.com?tag=).
      const domain = sig.on_hosts
        .map((d) => hostMatchesMerchantDomain(url.hostname, d))
        .find((d) => d !== null);
      if (domain && paramPresent(url.searchParams, sig.param)) {
        paramPrimary = true;
        merchant ??= domain;
        localEvidence.push({
          kind: 'merchant_param_match',
          detail: `param "${sig.param}" present on known merchant host "${domain}" (${rule.name})`,
          networkId: rule.id,
          host: url.hostname,
          param: sig.param,
          merchant: domain,
        });
      }
    } else if (paramPresent(url.searchParams, sig.param)) {
      // Generic possible-tier param (?ref=, ?rfsn=, …): standalone but lowest
      // tier, never badged. `?ref=` is noise, not evidence (CLAUDE.md).
      paramPrimary = true;
      merchant ??= url.hostname;
      localEvidence.push({
        kind: 'possible_param',
        detail: `generic param "${sig.param}" present on "${url.hostname}" with no corroboration`,
        networkId: rule.id,
        host: url.hostname,
        param: sig.param,
      });
    }
  }

  if (!hostPrimary && !paramPrimary) {
    evidence.push(...localEvidence);
    return null;
  }

  // Corroboration for confirmed/likely networks: host-scoped params (?sid=,
  // ?irclickid=, ?murl=) strengthen but never create a match, and a
  // host_required param only corroborates once the host itself matched.
  if (rule.tier_on_match !== 'possible') {
    for (const sig of rule.param_signatures ?? []) {
      if (sig.on_hosts) continue;
      if (sig.host_required && !hostPrimary) continue;
      if (paramPresent(url.searchParams, sig.param)) {
        localEvidence.push({
          kind: 'corroborating_param',
          detail: `param "${sig.param}" corroborates the ${rule.name} match`,
          networkId: rule.id,
          param: sig.param,
        });
      }
    }
  }

  const { tier, capped } = effectiveTier(rule, hostPrimary ? unverifiedPattern : null);
  if (capped) {
    localEvidence.push({
      kind: 'unverified_signature',
      detail:
        hostPrimary && unverifiedPattern !== null
          ? `${rule.name} host pattern "${unverifiedPattern}" not yet confirmed against >= 4 observed URLs; ` +
            'capped at likely even though the entry itself is verified'
          : `${rule.name} signature not yet validated against >= 3 observed URLs; capped at likely`,
      networkId: rule.id,
      ...(hostPrimary && unverifiedPattern !== null ? { pattern: unverifiedPattern } : {}),
    });
  }

  evidence.push(...localEvidence);
  const kind = hostPrimary ? 'host' : 'param';
  return {
    networkId: rule.id,
    tier,
    confidence: MATCH_CONFIDENCE[`${tier}_${kind}`],
    merchant,
  };
}

/** Cloak patterns this path matches, in ruleset order. Evidence is recorded. */
function collectCloakHints(url: URL, ruleset: Ruleset, evidence: Evidence[]): string[] {
  const path = `${url.pathname.toLowerCase()}/`;
  const matched: string[] = [];
  for (const pattern of ruleset.cloak_path_hints?.patterns ?? []) {
    if (path.includes(pattern.toLowerCase())) {
      matched.push(pattern);
      evidence.push({
        kind: 'cloak_path_hint',
        detail: `path contains cloak pattern "${pattern}"; not evidence by itself — needs server-side resolution`,
        path: url.pathname,
        pattern,
      });
    }
  }
  return matched;
}

/** The merchant the publisher's own link declares, verbatim, or null. */
function declaredMerchant(url: URL): string | null {
  for (const name of PUBLISHER_DECLARED_MERCHANT_PARAMS) {
    const raw = url.searchParams.get(name);
    if (raw !== null && raw.trim() !== '') return raw.trim();
  }
  return null;
}

/**
 * The merchant a URL declares, verbatim, or null — the same reading the
 * classifier does, exported so the rate layer joins on the SAME string rather
 * than on a second implementation of this rule (ruling 2026-09-07b, item 2).
 * String work on a stored URL: nothing is fetched, resolved or normalised.
 */
export function declaredMerchantOfUrl(rawUrl: string): string | null {
  const url = parseHttpUrl(rawUrl);
  return url === null ? null : declaredMerchant(url);
}

/**
 * The vendor a URL declares under any of PUBLISHER_DECLARED_VENDOR_PARAMS,
 * with the parameter it was read from, or null (ruling 2026-09-08c).
 *
 * First parameter present wins, in the list's own order, so a URL carrying
 * both `merchant=` and `name=` reads exactly as it did before this ruling.
 * String work on a stored URL: nothing is fetched, resolved or normalised.
 */
export function declaredVendorOfUrl(rawUrl: string): DeclaredVendor | null {
  const url = parseHttpUrl(rawUrl);
  if (url === null) return null;
  for (const param of PUBLISHER_DECLARED_VENDOR_PARAMS) {
    const raw = url.searchParams.get(param);
    if (raw !== null && raw.trim() !== '') return { param, value: raw.trim() };
  }
  return null;
}

/**
 * The candidate vendor names a URL writes into its own PATH, in document
 * order — ruling 2026-09-08d (docs/EXTRACTION.md §10.1).
 *
 * Percent-decoded, trimmed and lowercased, empty segments dropped. That is
 * ALL this function does: it reports the segments, exactly as
 * `declaredVendorOfUrl` reports a parameter's value, and decides nothing
 * about any of them.
 *
 * **The two guards that make it safe live in the caller, and neither is
 * optional.**
 *
 *  1. **Scope.** Only a SAME-HOST CLOAK may be read this way — the link's
 *     registrable domain equals the publisher's, and either its path matches
 *     a `cloak_path_hints` pattern or the publisher marked the anchor
 *     `rel="sponsored"`. A publisher's own ARTICLE urls are
 *     same-registrable-domain too, and a merchant's own product url has a
 *     path as well; neither is a declaration about who is paying.
 *  2. **The mapping condition**, unchanged from §10: a segment is a rate key
 *     ONLY where it maps to a merchant we already hold a rate card for. The
 *     crawler's `declaredPathMerchantRateHost` is where that lookup happens.
 *
 * Matching is on the WHOLE segment. `security.org/go/surfshark-antivirus`
 * names Surfshark's ANTIVIRUS, and the rate card we hold for Surfshark was
 * fetched from its VPN affiliate page — so a prefix rule would price nine
 * antivirus clicks at a VPN rate nobody published for them. Splitting a slug
 * on a hyphen is a guess about its meaning, and HARD RULE 2 forbids inventing
 * a rate.
 *
 * String work on a stored URL: nothing is fetched, resolved or normalised
 * beyond the decode.
 */
export function declaredVendorPathSegments(rawUrl: string): string[] {
  const url = parseHttpUrl(rawUrl);
  if (url === null) return [];
  return url.pathname
    .split('/')
    .filter((s) => s !== '')
    .map((s) => {
      try {
        return decodeURIComponent(s).trim().toLowerCase();
      } catch {
        return s.trim().toLowerCase();
      }
    })
    .filter((s) => s !== '');
}


// ---------------------------------------------------------------------------
// Declared DESTINATION — ruling 2026-09-07e (docs/NYMAG-MECHANISM.md §6 P3)
// ---------------------------------------------------------------------------

/**
 * A redirect host that DECLARES its own destination, twice, inside its own
 * URL — once as a full destination URL and once as a merchant domain.
 *
 * EXACTLY this list, grown only by ratified amendment on observed evidence.
 * Today: `ncls1.com`, which nymag.com routes 1,030 of its product links
 * through:
 *
 *   https://ncls1.com/irk?enk=<base64>&subid=nymag.com&…&d=<DESTINATION URL>
 *   base64(enk) -> o=<cskey>&s=<siteid>&b=<merchant id>&bkd=<merchant domain>
 *
 * WHAT THIS IS AND IS NOT. It is a RATE KEY, on exactly the footing of
 * Wirecutter's `merchant=` (ruling 2026-09-07c) and CNET's decoded `url=`:
 * the publisher's own statement, in its own markup, about where the link
 * goes. It is NOT a tier, NOT a badge, and NOT evidence that `ncls1.com` pays
 * a commission — `ncls1.com/robots.txt` is an explicit blanket `Disallow: /`,
 * we have never observed the hop, and we do not know what the host is. A
 * redirector that declares its destination is not thereby a commission.
 * `classify()` is untouched by this and returns exactly what it returned
 * before.
 */
export interface DeclaredDestinationRedirector {
  /** Exact host; a leading `www.` on the observed host is ignored. */
  host: string;
  /** Param carrying a full http(s) destination URL. */
  destinationParam: string;
  /** Param carrying base64 of a query string. */
  corroborationParam: string;
  /** Key inside the decoded query string naming the merchant domain. */
  corroborationKey: string;
}

export const DECLARED_DESTINATION_REDIRECTORS: readonly DeclaredDestinationRedirector[] = [
  { host: 'ncls1.com', destinationParam: 'd', corroborationParam: 'enk', corroborationKey: 'bkd' },
];

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Decode base64 to a PRINTABLE-ASCII string, or null.
 *
 * Written out rather than delegated to `atob`/`Buffer` because `core` has zero
 * runtime dependencies and runs in both a browser extension and Node, and
 * because a hostile lawyer reading this file should not have to reason about
 * which global was in scope.
 *
 * REFUSES on anything that is not plainly a base64-encoded ASCII query string:
 * one character outside the alphabet, or one decoded byte outside printable
 * ASCII, returns null. The value it is applied to is an opaque token on
 * someone else's redirector, and declining to interpret it is free — the
 * caller then declares no merchant.
 */
export function decodeBase64Ascii(raw: string): string | null {
  const cleaned = raw.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  if (cleaned === '') return null;
  let acc = 0;
  let bits = 0;
  let out = '';
  for (const ch of cleaned) {
    const v = BASE64_ALPHABET.indexOf(ch);
    if (v < 0) return null;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits < 8) continue;
    bits -= 8;
    const byte = (acc >> bits) & 0xff;
    if (byte < 0x20 || byte > 0x7e) return null;
    out += String.fromCharCode(byte);
  }
  return out === '' ? null : out;
}

function bareHost(hostname: string): string {
  const h = hostname.toLowerCase();
  return h.startsWith('www.') ? h.slice(4) : h;
}

/**
 * The merchant host a known redirector DECLARES for itself, or null.
 *
 * BOTH DECLARATIONS MUST AGREE. The destination param must parse as an
 * http(s) URL, the corroboration param must base64-decode to a query string
 * carrying the merchant-domain key, and the two must name the SAME host after
 * stripping `www.`. Disagreement returns null and the pick keeps `r_i = null`.
 *
 * That is stricter than reading either one alone, and deliberately so: one
 * declaration is a claim, two independent encodings of the same claim inside
 * one URL are a claim the publisher's own tooling checked. MEASURED over the
 * 1,030 `ncls1.com` links in the corpus: 1,028 agree exactly and 2 do not —
 * both because `d=` lands on a subdomain (`support.thehonestkitchen.com`) of
 * the domain `bkd=` names. Those two declare nothing rather than be resolved
 * by a rule invented to accommodate them.
 *
 * STRING WORK ON A STORED URL. Nothing is fetched, resolved or fired, and the
 * URL is never modified. HARD RULE 1 is untouched.
 */
export function declaredDestinationHost(rawUrl: string): string | null {
  const url = parseHttpUrl(rawUrl);
  if (url === null) return null;
  const host = bareHost(url.hostname);
  const entry = DECLARED_DESTINATION_REDIRECTORS.find((r) => r.host === host);
  if (entry === undefined) return null;

  const rawDestination = url.searchParams.get(entry.destinationParam);
  if (rawDestination === null || rawDestination === '') return null;
  const destination = parseHttpUrl(rawDestination);
  if (destination === null) return null;
  const destinationHost = bareHost(destination.hostname);
  if (destinationHost === '') return null;

  const rawCorroboration = url.searchParams.get(entry.corroborationParam);
  if (rawCorroboration === null || rawCorroboration === '') return null;
  const decoded = decodeBase64Ascii(rawCorroboration);
  if (decoded === null) return null;
  const declared = new URLSearchParams(decoded).get(entry.corroborationKey);
  if (declared === null || declared === '') return null;
  // The corroboration value is a domain, sometimes with a locale path
  // ("sonos.com/en-us"). Only the host part is compared.
  const declaredHost = bareHost((declared.split('/')[0] ?? '').trim());
  if (declaredHost === '') return null;

  return declaredHost === destinationHost ? destinationHost : null;
}

/**
 * The publisher-declaration rule (docs/LABELING.md §2 rule 5, ruling
 * 2026-09-07, AMENDED 2026-09-07b to key on the DOMAIN rather than the path).
 *
 * Two facts, both observed and neither inferred: the anchor carries
 * `rel="sponsored"`, and the link's registrable domain either is or is not
 * the source article's.
 *
 * WHY THE PATH REQUIREMENT WENT. It asked the wrong question. `/go/`,
 * `/out/`, `/recommends/` is a list of shapes we have seen publishers use,
 * and a publisher using a shape not on the list — CNET's `cc.cnet.com/v1/otc/`
 * — was silently missed while the identical declaration on `/out/` was
 * badged. Whether a link is the publisher's own redirector is a question
 * about WHOSE DOMAIN IT IS, and the registrable domain answers it directly
 * instead of by pattern-matching the publisher's URL taste.
 *
 * SAME registrable domain → `likely`. It NEVER reaches `confirmed`: a
 * signature asserts something about the world that we verified against >= 4
 * observed URLs; this asserts only that the publisher said so. It establishes
 * that the link is PAID, not where it goes — the merchant is taken only from
 * a param the publisher itself declared it in, and is null otherwise. No
 * destination is guessed and nothing is fetched.
 *
 * DIFFERENT registrable domain → `possible`, NEVER badged. The publisher has
 * marked a direct link to someone else's site as paid placement, and no
 * affiliate mechanism is detectable on the link. `rel="sponsored"` is the
 * correct attribute for paid placement that carries no commission at all, so
 * treating it as monetization would badge on the publisher's compliance
 * rather than on evidence of a commission. It is published as a count.
 *
 * Absent `rel="sponsored"` or absent a source article, neither branch fires.
 */
function publisherDeclaredCandidate(
  url: URL,
  rel: string | null | undefined,
  sourceUrl: string | null | undefined,
  evidence: Evidence[],
): Candidate | null {
  if (!hasSponsoredRel(rel)) return null;

  const linkDomain = registrableDomain(url.hostname);
  const sourceDomain =
    typeof sourceUrl === 'string' && sourceUrl !== ''
      ? (() => {
          try {
            return registrableDomain(new URL(sourceUrl).hostname);
          } catch {
            return null;
          }
        })()
      : null;

  if (sourceDomain === null || linkDomain === null) {
    // The declaration was observed and is recorded; it is not classified,
    // because the question "is this the publisher's own domain" has no answer
    // here. Silence would hide an observation we actually made.
    evidence.push({
      kind: 'publisher_declared_unattributable',
      detail:
        `rel="${rel}" declares this link sponsored, but it cannot be attributed to a ` +
        'publisher domain (no source article was supplied, or a host has no registrable ' +
        'domain), so no declaration rule fires',
      host: url.hostname,
      path: url.pathname,
    });
    return null;
  }

  const merchant = declaredMerchant(url);
  const sameDomain = linkDomain === sourceDomain;

  if (sameDomain) {
    evidence.push({
      kind: 'publisher_declared',
      detail:
        `rel="${rel}" declares this link sponsored and its registrable domain ` +
        `"${linkDomain}" is the source article's own: the publisher's own declaration ` +
        'that a hop through its own infrastructure is paid. ' +
        (merchant === null
          ? 'No merchant is declared in the URL, so none is recorded.'
          : `Merchant declared by the publisher as "${merchant}".`) +
        ' A declaration is not a signature — capped at likely, never confirmed.',
      networkId: PUBLISHER_DECLARED_NETWORK,
      host: url.hostname,
      path: url.pathname,
      pattern: linkDomain,
      ...(merchant !== null ? { merchant } : {}),
    });
    return {
      networkId: PUBLISHER_DECLARED_NETWORK,
      tier: 'likely',
      confidence: MATCH_CONFIDENCE.likely_declared,
      merchant,
    };
  }

  evidence.push({
    kind: 'publisher_declared_direct',
    detail:
      `rel="${rel}" declares this link sponsored, but its registrable domain ` +
      `"${linkDomain}" is not the source article's "${sourceDomain}": a direct link to ` +
      'another party that the publisher marked as paid placement, with no affiliate ' +
      'mechanism detected on the link. NEVER badged — `rel="sponsored"` is also correct ' +
      'for paid placement that pays no commission.',
    networkId: PUBLISHER_DECLARED_DIRECT_NETWORK,
    host: url.hostname,
    path: url.pathname,
    pattern: linkDomain,
    ...(merchant !== null ? { merchant } : {}),
  });
  return {
    networkId: PUBLISHER_DECLARED_DIRECT_NETWORK,
    tier: 'possible',
    confidence: MATCH_CONFIDENCE.possible_declared,
    merchant: merchant ?? url.hostname,
  };
}

const NONE: Classification = {
  tier: 'none',
  network: null,
  merchant: null,
  confidence: 0,
  evidence: [],
};

function classifyDirect(
  raw: string,
  ruleset: Ruleset,
  rel?: string | null,
  sourceUrl?: string | null,
): Classification {
  const url = parseHttpUrl(raw);
  if (!url) {
    return {
      ...NONE,
      evidence: [
        { kind: 'invalid_url', detail: 'input is not a valid http(s) URL', url: raw },
      ],
    };
  }

  const evidence: Evidence[] = [];
  const hosts = hostVariants(url.hostname);
  const candidates: Candidate[] = [];
  for (const rule of ruleset.networks) {
    const candidate = matchNetwork(rule, url, hosts, evidence);
    if (candidate) candidates.push(candidate);
  }
  // Cloak hints are still recorded as evidence — they are what tells the
  // rate layer a destination is unresolved — but they no longer gate the
  // publisher-declaration rule (ruling 2026-09-07b).
  collectCloakHints(url, ruleset, evidence);
  const declared = publisherDeclaredCandidate(url, rel, sourceUrl, evidence);
  if (declared) candidates.push(declared);

  return pickBest(candidates, evidence);
}

function pickBest(candidates: Candidate[], evidence: Evidence[]): Classification {
  if (candidates.length === 0) return { ...NONE, evidence };
  // Deterministic: highest tier, then highest confidence, then ruleset order
  // (Array.prototype.sort is stable).
  const best = [...candidates].sort(
    (a, b) => TIER_RANK[b.tier] - TIER_RANK[a.tier] || b.confidence - a.confidence,
  )[0]!;
  return {
    tier: best.tier,
    network: best.networkId,
    merchant: best.merchant,
    confidence: best.confidence,
    evidence,
  };
}

/**
 * Build a classifier over a validated ruleset (see parseRuleset).
 * The returned function is pure and never throws on bad URLs.
 */
export function createClassifier(
  ruleset: Ruleset,
): (url: string, opts?: ClassifyOptions) => Classification {
  return (rawUrl, opts) => {
    const direct = classifyDirect(rawUrl, ruleset, opts?.rel, opts?.sourceUrl);
    const resolvedUrl = opts?.resolvedUrl;
    if (!resolvedUrl || resolvedUrl === rawUrl) return direct;

    // No `rel` and no source article on the resolution: both belong to the
    // anchor the publisher published, not to the address a redirect happened
    // to end at.
    const resolved = classifyDirect(resolvedUrl, ruleset);
    const evidence: Evidence[] = [
      ...direct.evidence,
      {
        kind: 'resolved_destination',
        detail: `server-side resolution terminated at "${resolvedUrl}"`,
        url: resolvedUrl,
      },
      ...resolved.evidence,
    ];

    const candidates: Candidate[] = [];
    if (direct.tier !== 'none' && direct.network) {
      candidates.push({
        networkId: direct.network,
        tier: direct.tier,
        confidence: direct.confidence,
        merchant: direct.merchant,
      });
    }
    if (resolved.tier !== 'none' && resolved.network) {
      candidates.push({
        networkId: resolved.network,
        // Resolution terminating at a confirmed network yields `likely` for
        // the original link (CLAUDE.md tier table); weaker tiers pass through.
        tier: resolved.tier === 'confirmed' ? 'likely' : resolved.tier,
        confidence: round4(RESOLUTION_CONFIDENCE_FACTOR * resolved.confidence),
        merchant: resolved.merchant,
      });
    }
    return pickBest(candidates, evidence);
  };
}

/** One-shot convenience wrapper around createClassifier. */
export function classify(
  url: string,
  ruleset: Ruleset,
  opts?: ClassifyOptions,
): Classification {
  return createClassifier(ruleset)(url, opts);
}
