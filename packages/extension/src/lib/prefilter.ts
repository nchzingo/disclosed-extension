/**
 * prefilter.ts — which links are worth classifying, and which are candidates
 * for a resolution we do not have.
 *
 * Two admission routes, and they are different KINDS of thing:
 *
 *  1. **The host trie** (lib/trie.ts) — a link whose host appears in the
 *     bundle's signatures.
 *  2. **The publisher's own declaration** — `rel="sponsored"`. This one cannot
 *     be a trie entry: after the 2026-09-07b domain ruling a declaration
 *     classifies by comparing the link's registrable domain with the ARTICLE'S,
 *     so the deciding fact is not the host but the pair. Every such link is
 *     admitted unconditionally and `classify()` sorts them into `likely`
 *     (`publisher_cloak`, same domain) and `possible`
 *     (`publisher_declared_direct`, different domain — never badged).
 *
 * Reading the anchor: `a.hostname` / `a.search` / `a.pathname` are properties
 * the browser already parsed. Reading them allocates nothing and — the part
 * that matters — is a READ. Nothing in this package assigns to an anchor,
 * calls `click()`, or opens a URL (HARD RULE 1).
 */
import type { Ruleset } from '@disclosed/core';
import { hasSponsoredRel } from '@disclosed/core';
import {
  compileHostTrie,
  lazyParamLookup,
  type AdmitMask,
  type HostTrie,
} from './trie.js';

/** The publisher said this placement is paid. Not host-keyed; see above. */
export const ADMIT_DECLARATION = 8;

/** Everything the prefilter and the classifier need from one anchor. */
export interface LinkFacts {
  /** Absolute URL, as the browser resolved it. Never modified. */
  href: string;
  protocol: string;
  hostname: string;
  pathname: string;
  search: string;
  rel: string | null;
}

export interface Prefilter {
  /** Nonzero when the link should be handed to `classify()`. */
  admit(link: LinkFacts): AdmitMask;
  /**
   * A path shaped like a publisher cloak (`/go/`, `/out/`, `/recommends/`…).
   * Not evidence of anything by itself — it is what tells us a destination is
   * unresolved rather than absent, which is the k-anonymity lookup's input.
   */
  isCloakPath(pathname: string): boolean;
  readonly trie: HostTrie;
}

export function buildPrefilter(ruleset: Ruleset): Prefilter {
  const trie = compileHostTrie(ruleset);
  const cloakPatterns = (ruleset.cloak_path_hints?.patterns ?? []).map((p) => p.toLowerCase());
  return {
    trie,
    admit(link) {
      if (link.protocol !== 'http:' && link.protocol !== 'https:') return 0;
      let bits = trie.match(link.hostname, lazyParamLookup(link.search));
      if (hasSponsoredRel(link.rel)) bits |= ADMIT_DECLARATION;
      return bits;
    },
    isCloakPath(pathname) {
      // Same segment-bounded test as core's collectCloakHints().
      const padded = `${pathname.toLowerCase()}/`;
      return cloakPatterns.some((p) => padded.includes(p));
    },
  };
}

/**
 * The facts of one anchor, or null if it is not an http(s) link.
 *
 * `a.href` is the browser's resolved absolute URL. `a.getAttribute('href')` is
 * what the publisher wrote; we classify the resolved form because that is
 * where the reader would actually go, and we never write either one back.
 */
export function anchorFacts(a: HTMLAnchorElement): LinkFacts | null {
  const protocol = a.protocol;
  if (protocol !== 'http:' && protocol !== 'https:') return null;
  const href = a.href;
  if (href === '') return null;
  return {
    href,
    protocol,
    hostname: a.hostname,
    pathname: a.pathname,
    search: a.search,
    rel: a.getAttribute('rel'),
  };
}
