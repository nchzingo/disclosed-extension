/**
 * scan.ts — read the page, classify what the prefilter admits, mark what
 * `shouldBadge()` allows, and count everything else.
 *
 * THE ONE THING THIS FILE MUST NOT DO. It never writes to a link. It reads
 * `a.href`, `a.protocol`, `a.hostname`, `a.pathname`, `a.search` and
 * `a.getAttribute('rel')`, and the only DOM mutation in the whole scan is
 * lib/marker.ts inserting a sibling element into the anchor's parent. Anchors
 * are de-duplicated with a `WeakSet`, not with a marker attribute on the
 * anchor, precisely so that a scanned anchor is byte-identical to an unscanned
 * one (HARD RULE 1).
 *
 * WHAT GETS A BADGE. `shouldBadge()` from core, and nothing else.
 * `confirmed` and `likely` are marked; `possible` is COUNTED and never marked,
 * in any circumstance — it is the tier a bare `?ref=` lands in, and it is the
 * tier a `rel="sponsored"` link to someone else's domain lands in, and neither
 * is evidence of a commission (CLAUDE.md tier table, ruling 2026-09-07b).
 *
 * BOUNDED WORK. `maxLinks` caps how many anchors are ever examined on a page.
 * When the cap bites the report says so — a truncated scan that reported a
 * clean page would be an exoneration we did not earn.
 */
import {
  createClassifier,
  registrableDomainOfUrl,
  shouldBadge,
  PUBLISHER_DECLARED_DIRECT_NETWORK,
  type Classification,
  type Ruleset,
} from '@disclosed/core';
import { findDisclosure, type DisclosureFinding } from './disclosure.js';
import { collectPicks, type PagePick } from './picks.js';
import { insertMarker } from './marker.js';
import { anchorFacts, type Prefilter } from './prefilter.js';
import { ADMIT_REQUIRES_RESOLUTION } from './trie.js';

/**
 * Anchors examined per page. Chosen to be far above an ordinary review article
 * (the corpus's biggest article carries ~370 outbound links) and far below the
 * link count at which a full pass is perceptible.
 */
export const DEFAULT_MAX_LINKS = 2000;

/**
 * Distinct cloaked URLs one page may track.
 *
 * **Raised from 25 to 500 on 2026-09-08, and the reason is that this is no
 * longer a network bound.** It was 25 because 25 was the number of
 * k-anonymity buckets a page was allowed to request; with the resolution
 * table shipped inside the bundle, answering a cloak costs one SHA-256 and one
 * `Map.get`, and a cap tuned to the cost of an HTTP request was silently
 * refusing to EXPLAIN cloaks whose answers we already held. On a page with 70
 * cloaked links it left 45 of them reported as "destination unknown" while the
 * bundle in the same process knew the destination.
 *
 * The network bound is unchanged and now lives where it belongs:
 * `MAX_PREFIXES_PER_PAGE` in lib/kanon.ts still caps a request at 25 prefixes,
 * so if `resolutions_truncated` ever goes true the request stays exactly the
 * size it was. 500 is bounded by `maxLinks` (2000) above it and is a bound on
 * memory, not on traffic.
 */
export const DEFAULT_MAX_LOOKUPS = 500;

export interface PageReport {
  pageUrl: string;
  /** Registrable domain of the page — the publisher, for the card lookup. */
  publisher: string | null;
  anchorsInDocument: number;
  anchorsExamined: number;
  /** True when `maxLinks` stopped the scan before the end of the document. */
  capped: boolean;
  /** Anchors the prefilter admitted and `classify()` therefore judged. */
  classified: number;
  badgedConfirmed: number;
  badgedLikely: number;
  /** Badged links per network id, in insertion order. */
  byNetwork: Record<string, number>;
  /**
   * `possible`: counted, never badged, shown only on explicit request.
   *
   * **This count is a floor, not a total, and the popup says so.** The
   * prefilter does not hunt for the generic `possible`-tier params (`?ref=`,
   * `?rfsn=`) at all: they are never badged, and admitting every link that
   * carries a query string in order to count something we will not act on is
   * per-link work spent on nothing. What IS complete is
   * `declaredNotBadged` below.
   */
  possibleNotBadged: number;
  /**
   * `publisher_declared_direct`: links the publisher marked `rel="sponsored"`
   * pointing at someone else's registrable domain, with no affiliate mechanism
   * detected. **Complete for the links examined** — every `rel="sponsored"`
   * anchor is admitted by the prefilter — and never badged, because
   * `rel="sponsored"` is also the correct attribute for paid placement that
   * pays no commission (ruling 2026-09-07b).
   */
  declaredNotBadged: number;
  /**
   * Cloaked links whose destination we do not have AND cannot explain. Never
   * badged. Distinct from `cloakRefusedByOperator` below: this is "we have
   * never looked", that is "we looked and were told no".
   */
  cloakedUnresolved: number;
  /**
   * Cloaked links the embedded table answered with a REASON rather than a
   * destination — `robots_disallowed` (an operator published a refusal and we
   * honoured it), `blocked` (we were turned away), `not_a_redirect`.
   *
   * Counted apart from `cloakedUnresolved` because they are different
   * findings and docs/RESOLVER-SCOPE.md §2 refuses to merge them. Folding
   * them together would report a host that told us to go away as a host we
   * never got round to.
   */
  cloakRefusedByOperator: number;
  /**
   * Cloaked URLs answered from the bundle's own embedded table — with a
   * destination or with a reason. **Every one of these is an answer obtained
   * with no network request of any kind** (lib/resolutions.ts).
   *
   * COUNTED PER DISTINCT URL. `resolutionsApplied` and `resolvedNotBadged`
   * below are counted per ANCHOR, because badging is per anchor and two
   * anchors can carry the same href with different `rel`. The two units are
   * not interchangeable and this field says which it is.
   */
  cloaksAnsweredFromBundle: number;
  /** Cloaked links a server-side resolution let us classify. */
  resolutionsApplied: number;
  /**
   * Cloaked links a resolution DID reach and that still classify below the
   * badge line. Counted rather than dropped, so every cloaked link on the page
   * stays in exactly one bucket: badged, resolved-and-not-badged, or
   * destination unknown.
   */
  resolvedNotBadged: number;
  picks: PagePick[];
  picksWithBadgedLink: number;
  disclosure: DisclosureFinding | null;
}

export interface ScannerOptions {
  ruleset: Ruleset;
  prefilter: Prefilter;
  maxLinks?: number;
  /** Distinct cloaked URLs tracked. A memory bound, not a network one. */
  maxLookups?: number;
  /** Called for each newly badged anchor. Defaults to inserting a marker. */
  onBadge?: (anchor: HTMLAnchorElement, c: Classification) => void;
}

export class Scanner {
  private readonly doc: Document;
  private readonly opts: Required<Omit<ScannerOptions, 'onBadge'>> & {
    onBadge: (a: HTMLAnchorElement, c: Classification) => void;
  };
  private readonly classify: ReturnType<typeof createClassifier>;
  /** Anchors already examined. A WeakSet so the DOM carries no mark of us. */
  private readonly seen = new WeakSet<HTMLAnchorElement>();
  private readonly badgedAnchors: HTMLAnchorElement[] = [];
  /** Cloaked, unbadged, unresolved: href -> the anchors carrying it. */
  private readonly pending = new Map<string, HTMLAnchorElement[]>();
  private examined = 0;
  private classified = 0;
  private confirmed = 0;
  private likely = 0;
  private possible = 0;
  private declaredDirect = 0;
  private resolutionsApplied = 0;
  private resolvedNotBadged = 0;
  private cloaksAnsweredFromBundle = 0;
  private cloakRefusedByOperator = 0;
  private capped = false;
  private readonly networks = new Map<string, number>();

  constructor(doc: Document, opts: ScannerOptions) {
    this.doc = doc;
    this.opts = {
      ruleset: opts.ruleset,
      prefilter: opts.prefilter,
      maxLinks: opts.maxLinks ?? DEFAULT_MAX_LINKS,
      maxLookups: opts.maxLookups ?? DEFAULT_MAX_LOOKUPS,
      onBadge: opts.onBadge ?? ((a, c) => void insertMarker(a, c)),
    };
    this.classify = createClassifier(opts.ruleset);
  }

  /**
   * Examine every anchor not yet seen. Safe to call again — that is how a
   * page that adds links after load is covered, and the `WeakSet` means the
   * second pass costs one lookup per already-examined anchor.
   */
  scan(root: ParentNode = this.doc): void {
    const anchors = root.querySelectorAll('a[href]');
    for (const node of anchors) {
      const anchor = node as HTMLAnchorElement;
      if (this.seen.has(anchor)) continue;
      if (this.examined >= this.opts.maxLinks) {
        this.capped = true;
        return;
      }
      this.seen.add(anchor);
      this.examined++;
      this.examine(anchor);
    }
  }

  private examine(anchor: HTMLAnchorElement): void {
    const facts = anchorFacts(anchor);
    if (facts === null) return;
    const admit = this.opts.prefilter.admit(facts);
    if (admit === 0) return;

    this.classified++;
    const c = this.classify(facts.href, {
      // Both halves of the publisher-declaration rule, exactly as the corpus
      // supplies them: the anchor's own `rel`, and the page it is on.
      rel: facts.rel,
      sourceUrl: this.doc.URL,
    });
    if (this.record(anchor, c)) return;

    // Not badged. Is it a link whose destination we simply do not have?
    // `requires_resolution` hosts (amzn.to) and publisher cloak paths are the
    // two shapes; both stay UNBADGED until a resolution says otherwise.
    const cloaked =
      (admit & ADMIT_REQUIRES_RESOLUTION) !== 0 ||
      this.opts.prefilter.isCloakPath(facts.pathname);
    if (!cloaked) return;
    const existing = this.pending.get(facts.href);
    if (existing !== undefined) existing.push(anchor);
    else if (this.pending.size < this.opts.maxLookups) this.pending.set(facts.href, [anchor]);
  }

  /** Badge if the tier allows it. Returns true when a badge was applied. */
  private record(anchor: HTMLAnchorElement, c: Classification): boolean {
    if (!shouldBadge(c.tier)) {
      if (c.tier === 'possible') {
        this.possible++;
        if (c.network === PUBLISHER_DECLARED_DIRECT_NETWORK) this.declaredDirect++;
      }
      return false;
    }
    if (c.tier === 'confirmed') this.confirmed++;
    else this.likely++;
    const key = c.network ?? 'unknown_network';
    this.networks.set(key, (this.networks.get(key) ?? 0) + 1);
    this.badgedAnchors.push(anchor);
    this.opts.onBadge(anchor, c);
    return true;
  }

  /**
   * Cloaked URLs with no destination — the input to the k-anonymity lookup.
   * The URLs themselves NEVER leave the browser; only the first five hex
   * characters of each one's SHA-256 do (lib/kanon.ts).
   */
  pendingCloaks(): string[] {
    return [...this.pending.keys()];
  }

  /**
   * Apply destinations obtained server-side and badge what they now justify.
   *
   * The resolution is DATA handed to `classify()` as `resolvedUrl`. This
   * extension never follows a redirect itself: the reader's browser must not
   * fire an affiliate cookie, which is the crime we exist to expose
   * (CLAUDE.md, Privacy architecture point 3).
   */
  applyResolutions(destinations: ReadonlyMap<string, string>): void {
    for (const [href, destination] of destinations) this.applyDestination(href, destination);
  }

  /**
   * Apply the answers the SHIPPED table gave (lib/resolutions.ts), which is
   * every answer this extension gets at the current corpus size.
   *
   * A row with a destination behaves exactly as a network resolution would —
   * same `classify()` call, same per-anchor discipline. A row WITHOUT one is
   * still an answer and is recorded as one: we know why that cloak is
   * unresolved, and "the operator refused" is a finding, not a gap.
   */
  applyLocalAnswers(answers: ReadonlyMap<string, { destination: string | null }>): void {
    for (const [href, answer] of answers) {
      if (!this.pending.has(href)) continue;
      this.cloaksAnsweredFromBundle++;
      if (answer.destination !== null) {
        this.applyDestination(href, answer.destination);
        continue;
      }
      this.cloakRefusedByOperator++;
      this.pending.delete(href);
    }
  }

  private applyDestination(href: string, destination: string): void {
    const anchors = this.pending.get(href);
    if (anchors === undefined) return;
    // PER ANCHOR, not per URL. Two anchors can carry the same href with
    // different `rel`, and `rel="sponsored"` is half of a rule that badges.
    // Classifying once and applying the answer to all of them would badge an
    // anchor on a declaration that belonged to a different anchor.
    for (const anchor of anchors) {
      const c = this.classify(href, {
        rel: anchor.getAttribute('rel'),
        sourceUrl: this.doc.URL,
        resolvedUrl: destination,
      });
      if (this.record(anchor, c)) this.resolutionsApplied++;
      else this.resolvedNotBadged++;
    }
    // The destination is known now, whatever it turned out to be, so this
    // link is no longer "cloaked, destination unknown". Every link stays in
    // exactly one bucket: badged, resolved-and-not-badged, refused, or
    // unresolved.
    this.pending.delete(href);
  }

  report(): PageReport {
    const badged = this.badgedAnchors;
    const picks = collectPicks(this.doc, badged);
    const byNetwork: Record<string, number> = {};
    for (const [id, n] of this.networks) byNetwork[id] = n;
    return {
      pageUrl: this.doc.URL,
      publisher: registrableDomainOfUrl(this.doc.URL),
      anchorsInDocument: this.doc.querySelectorAll('a[href]').length,
      anchorsExamined: this.examined,
      capped: this.capped,
      classified: this.classified,
      badgedConfirmed: this.confirmed,
      badgedLikely: this.likely,
      byNetwork,
      possibleNotBadged: this.possible,
      declaredNotBadged: this.declaredDirect,
      cloakedUnresolved: this.pending.size,
      cloakRefusedByOperator: this.cloakRefusedByOperator,
      cloaksAnsweredFromBundle: this.cloaksAnsweredFromBundle,
      resolutionsApplied: this.resolutionsApplied,
      resolvedNotBadged: this.resolvedNotBadged,
      picks,
      picksWithBadgedLink: picks.filter((p) => p.badgedLinks > 0).length,
      disclosure: findDisclosure(this.doc, badged[0] ?? null),
    };
  }
}
