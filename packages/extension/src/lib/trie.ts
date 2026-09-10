/**
 * trie.ts — the compiled host matcher. A PREFILTER, never a classifier.
 *
 * WHAT IT IS FOR. CLAUDE.md's performance constraint: "Compiled trie matcher.
 * Not 500 regexes per link." The bundle carries 18 network entries with ~100
 * host patterns between them; running every pattern against every anchor on a
 * page with a thousand links is the kind of work a reader feels. This walks a
 * reversed-label trie once per link — `*.pxf.io` and `prf.hn` resolve in the
 * same walk — and answers one question: is this link worth handing to
 * `classify()`?
 *
 * IT DECIDES NOTHING ELSE. `classify()` (core) remains the only thing in this
 * system that assigns a tier, and this file deliberately re-implements as
 * little of it as it can:
 *
 *  - **Paths are not consulted.** `shareasale.com/about` is admitted here and
 *    thrown out by `classify()`, which is the correct division of labour: a
 *    prefilter false positive costs one function call, a prefilter false
 *    NEGATIVE is a link we never looked at and therefore a silent recall bug
 *    that no test of the classifier can see. The asymmetry decides every
 *    judgment call in this file.
 *  - **`requires_resolution` hosts are admitted** (`amzn.to`), even though
 *    `classify()` returns `none` for them unaided. They are the candidates for
 *    the k-anonymity lookup — see lib/kanon.ts.
 *  - **The publisher declaration rule is NOT HERE AT ALL.** A link is
 *    `publisher_cloak` because of `rel="sponsored"` and whose domain it points
 *    at, which is a fact about the anchor and not about the host set. No host
 *    trie can see it, so lib/prefilter.ts admits declarations directly. Losing
 *    that would silently drop every Wirecutter and CNET badge on the page.
 *
 * MATCHING MIRRORS `classify()` EXACTLY, including the parts that look odd:
 * a leading `www.` is stripped and BOTH forms are walked, because
 * `www.pxf.io` matches `*.pxf.io` on the unstripped form and
 * `www.anrdoezrs.net` matches the exact pattern `anrdoezrs.net` only on the
 * stripped one. Dropping either walk drops badges.
 */
import type { Ruleset } from '@disclosed/core';

/** Why the prefilter admitted a link. A bitmask so one walk can report all. */
export const ADMIT_HOST = 1;
/** A merchant domain that only matters when its affiliate param is present. */
export const ADMIT_MERCHANT_PARAM = 2;
/** A host that is not evidence alone and needs server-side resolution. */
export const ADMIT_REQUIRES_RESOLUTION = 4;

/** Anything nonzero means "hand this to classify()". */
export type AdmitMask = number;

/** What a node admits: unconditionally, and per query-parameter name. */
interface Admission {
  unconditional: AdmitMask;
  byParam: Map<string, AdmitMask> | null;
}

interface TrieNode {
  children: Map<string, TrieNode>;
  /** Applies when the host ends exactly here. */
  exact: Admission | null;
  /** Applies when the host has at least one more label below here. */
  descendant: Admission | null;
}

/** Presence of a query parameter NAME, resolved lazily. */
export interface ParamLookup {
  has(name: string): boolean;
}

export interface HostTrie {
  /** Nonzero when the link is worth classifying. */
  match(hostname: string, params: ParamLookup): AdmitMask;
  /** Counts, for the popup's "what shipped" panel and for tests. */
  readonly patternCount: number;
}

function newNode(): TrieNode {
  return { children: new Map(), exact: null, descendant: null };
}

function newAdmission(): Admission {
  return { unconditional: 0, byParam: null };
}

/** Reversed labels: "go.skimresources.com" -> ["com", "skimresources", "go"]. */
function reversedLabels(host: string): string[] {
  return host.toLowerCase().split('.').reverse();
}

function walkToNode(root: TrieNode, host: string): TrieNode {
  let node = root;
  for (const label of reversedLabels(host)) {
    let next = node.children.get(label);
    if (next === undefined) {
      next = newNode();
      node.children.set(label, next);
    }
    node = next;
  }
  return node;
}

function admitInto(slot: 'exact' | 'descendant', node: TrieNode, kind: AdmitMask, param?: string): void {
  const admission = (node[slot] ??= newAdmission());
  if (param === undefined) {
    admission.unconditional |= kind;
    return;
  }
  admission.byParam ??= new Map();
  admission.byParam.set(param, (admission.byParam.get(param) ?? 0) | kind);
}

/**
 * Compile a bundle's host patterns into one trie.
 *
 * Built ONCE, on the first idle callback, and reused for the life of the page.
 */
export function compileHostTrie(ruleset: Ruleset): HostTrie {
  const root = newNode();
  let patternCount = 0;

  /** `pattern` is either an exact host or a `*.suffix` wildcard, as in core. */
  const addHostPattern = (pattern: string, kind: AdmitMask): void => {
    patternCount++;
    if (pattern.startsWith('*.')) {
      // "*.example.com" matches subdomains of example.com but NEVER the apex —
      // so the admission hangs off the descendant slot only.
      admitInto('descendant', walkToNode(root, pattern.slice(2)), kind);
    } else {
      admitInto('exact', walkToNode(root, pattern), kind);
    }
  };

  for (const rule of ruleset.networks) {
    for (const p of rule.host_patterns ?? []) addHostPattern(p, ADMIT_HOST);
    // Unverified patterns match exactly as verified ones do; the cap they
    // carry is a TIER cap applied by classify(), not a matching difference.
    for (const p of rule.unverified_host_patterns ?? []) addHostPattern(p, ADMIT_HOST);
    for (const p of rule.requires_resolution ?? []) addHostPattern(p, ADMIT_REQUIRES_RESOLUTION);
    for (const host of Object.keys(rule.known_merchant_subdomains ?? {})) {
      addHostPattern(host, ADMIT_HOST);
    }
    for (const sig of rule.param_signatures ?? []) {
      // `on_hosts` is the known-param-on-known-merchant pair (amazon.com?tag=).
      // core matches the domain AND any subdomain of it, and the param is what
      // makes it a signal at all — so the admission is gated on the param name
      // in both slots. A bare amazon.com link with no `tag` is not admitted,
      // and classify() would have returned `none` for it anyway.
      //
      // Params with no `on_hosts` are the `possible`-tier generics (`?ref=`,
      // `?rfsn=`). They are NEVER badged, so nothing is lost by leaving them
      // out, and leaving them out is what keeps the prefilter from admitting
      // half the web.
      for (const domain of sig.on_hosts ?? []) {
        patternCount++;
        const node = walkToNode(root, domain);
        admitInto('exact', node, ADMIT_MERCHANT_PARAM, sig.param);
        admitInto('descendant', node, ADMIT_MERCHANT_PARAM, sig.param);
      }
    }
  }

  const admitBits = (admission: Admission | null, params: ParamLookup): AdmitMask => {
    if (admission === null) return 0;
    let bits = admission.unconditional;
    if (admission.byParam !== null) {
      for (const [param, kind] of admission.byParam) {
        if (params.has(param)) bits |= kind;
      }
    }
    return bits;
  };

  const walk = (host: string, params: ParamLookup): AdmitMask => {
    const labels = reversedLabels(host);
    let node: TrieNode | undefined = root;
    let bits = 0;
    for (let i = 0; i < labels.length; i++) {
      node = node.children.get(labels[i]!);
      if (node === undefined) break;
      bits |= admitBits(i === labels.length - 1 ? node.exact : node.descendant, params);
    }
    return bits;
  };

  return {
    patternCount,
    match(hostname, params) {
      const host = hostname.toLowerCase();
      if (host === '') return 0;
      // Both forms, exactly as core's hostVariants(): stripping www would lose
      // exact-pattern matches, and not stripping it would lose wildcard ones.
      let bits = walk(host, params);
      if (host.startsWith('www.')) bits |= walk(host.slice(4), params);
      return bits;
    },
  };
}

/**
 * Query-parameter names, parsed on FIRST USE and only then.
 *
 * Most links never reach a param-gated node, and parsing a query string for
 * every anchor on the page to answer a question nobody asks is exactly the
 * per-link cost the trie exists to avoid.
 */
export function lazyParamLookup(search: string): ParamLookup {
  let names: Set<string> | null = null;
  return {
    has(name) {
      if (names === null) {
        names = new Set<string>();
        for (const [key] of new URLSearchParams(search)) names.add(key);
      }
      return names.has(name);
    },
  };
}
