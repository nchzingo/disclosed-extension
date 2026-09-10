/**
 * bundle.ts — the rules bundle, embedded at BUILD time and treated as DATA.
 *
 * THE BUNDLE IS DATA, NEVER CODE. `data/bundle/rules-latest.json` is imported
 * by the bundler and inlined into this package's output as a JSON literal. It
 * is never fetched at runtime, never `eval`'d, never `new Function`'d, and
 * never executed in any other form — Manifest V3 forbids remote code execution
 * and this extension does not go near the line (CLAUDE.md, Privacy
 * architecture point 1). The consequence a reader should notice: the extension
 * classifies with the rules it shipped with, and shipping new rules means
 * shipping a new version through the store.
 *
 * IT IS ALSO UNTRUSTED. `src/env.d.ts` types every JSON import as `unknown`,
 * so nothing below can read a field without first checking it. `parseRuleset`
 * (core) validates the signatures and throws on the first violation; the card
 * parser here does the same for the card summaries. A malformed bundle must
 * fail loudly at load, never silently misclassify — the caller catches, badges
 * nothing, and says so.
 */
import { parseRuleset, type Ruleset } from '@disclosed/core';
import rawBundle from '../../../../data/bundle/rules-latest.json';

/**
 * The card fields the bundle carries. A strict subset of the published card
 * (packages/crawler/src/build-rules-bundle.ts, `BundleCard`), re-declared here
 * rather than imported because the crawler depends on Playwright and this
 * package must not.
 */
export interface BundleCard {
  publisher: string;
  status: string;
  headline: string;
  /** SPEC §1.1 — a fact, never scored. */
  mBar: number | null;
  /** SPEC §0.1.0 — `M̄` with the runtime-attribution basis removed. */
  mBarBadgedOnly: number | null;
  articles: number;
  /**
   * SPEC §2.2. **Null unless the publisher is over the publication
   * threshold**, and the bundle builder is what nulls it. Nothing in this
   * package reconstructs one: below the threshold a card travels as its STATE,
   * and a state is not a number (see lib/cards.ts).
   */
  medianRho: number | null;
  ci95: [number, number] | null;
  n: number | null;
  publishable: boolean;
  rateCoverage: number | null;
  disclosure: {
    meanDeficiency: number | null;
    distribution: Record<string, number>;
  };
  gamingFlagCount: number;
  generatedAt: string;
  specVersion: string;
}

/**
 * One shipped resolution. **Keyed by hash; there is no URL in the bundle.**
 *
 * `status` is carried and never collapsed into "we have a destination or we
 * do not". `robots_disallowed` means the host's operator published a refusal
 * and we honoured it — a FINDING a reader is entitled to see, and a different
 * thing from a URL we simply never looked at.
 */
export interface BundleResolution {
  destination: string | null;
  status: string;
  observedAt: string;
}

export interface LoadedBundle {
  schemaVersion: number;
  bundleVersion: number;
  generatedAt: string;
  specVersion: string;
  /** SHA-256 of the bundle body with this field removed. Shown in the popup. */
  sha256: string;
  /** Validated by core. The only thing classification is allowed to read. */
  ruleset: Ruleset;
  /** Cards by publisher host, exactly as the bundle spells them. */
  cards: ReadonlyMap<string, BundleCard>;
  /** `sha256(url)` -> what we observed. The whole table, unless truncated. */
  resolutions: ReadonlyMap<string, BundleResolution>;
  /**
   * **THE NETWORK GATE.** False means the whole resolution table shipped and
   * this extension must make no network call at all — see lib/kanon.ts and
   * entrypoints/content.ts. True means the table shipped incomplete and the
   * k-anonymity endpoint is the fallback it was built to be.
   *
   * The wire name is `resolutions_truncated` and is read verbatim: it is a
   * contract between two independently-built consumers, and a field renamed on
   * one side of a gate is a gate that silently opens on the other.
   */
  resolutionsTruncated: boolean;
  /** Rows held in the corpus, which equals `resolutions.size` unless truncated. */
  resolutionsTotal: number;
  notes: readonly string[];
}

function fail(path: string, expected: string): never {
  throw new Error(`invalid rules bundle: ${path} must be ${expected}`);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function requireString(v: unknown, path: string): string {
  if (typeof v !== 'string' || v.length === 0) fail(path, 'a non-empty string');
  return v;
}

function requireNumber(v: unknown, path: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(path, 'a finite number');
  return v;
}

function nullableNumber(v: unknown, path: string): number | null {
  if (v === null || v === undefined) return null;
  return requireNumber(v, path);
}

function requireBoolean(v: unknown, path: string): boolean {
  if (typeof v !== 'boolean') fail(path, 'a boolean');
  return v;
}

function nullableInterval(v: unknown, path: string): [number, number] | null {
  if (v === null || v === undefined) return null;
  if (!Array.isArray(v) || v.length !== 2) fail(path, 'a [lower, upper] pair or null');
  return [requireNumber(v[0], `${path}[0]`), requireNumber(v[1], `${path}[1]`)];
}

function requireCountMap(v: unknown, path: string): Record<string, number> {
  if (!isRecord(v)) fail(path, 'an object of counts');
  const out: Record<string, number> = {};
  for (const [k, n] of Object.entries(v)) out[k] = requireNumber(n, `${path}.${k}`);
  return out;
}

/**
 * One card summary.
 *
 * The threshold invariant is enforced HERE as well as in the builder, because
 * this is the copy that reaches a reader: a card that is not `publishable`
 * carries no median, no CI and no `n`-backed number, and one that tries to is
 * a bundle we refuse rather than a card we quietly clean up.
 */
export function parseBundleCard(v: unknown, path: string): BundleCard {
  if (!isRecord(v)) fail(path, 'an object');
  const disclosure = isRecord(v.disclosure) ? v.disclosure : fail(`${path}.disclosure`, 'an object');
  const card: BundleCard = {
    publisher: requireString(v.publisher, `${path}.publisher`),
    status: requireString(v.status, `${path}.status`),
    headline: requireString(v.headline, `${path}.headline`),
    mBar: nullableNumber(v.mBar, `${path}.mBar`),
    mBarBadgedOnly: nullableNumber(v.mBarBadgedOnly, `${path}.mBarBadgedOnly`),
    articles: requireNumber(v.articles, `${path}.articles`),
    medianRho: nullableNumber(v.medianRho, `${path}.medianRho`),
    ci95: nullableInterval(v.ci95, `${path}.ci95`),
    n: nullableNumber(v.n, `${path}.n`),
    publishable: requireBoolean(v.publishable, `${path}.publishable`),
    rateCoverage: nullableNumber(v.rateCoverage, `${path}.rateCoverage`),
    disclosure: {
      meanDeficiency: nullableNumber(disclosure.meanDeficiency, `${path}.disclosure.meanDeficiency`),
      distribution: requireCountMap(disclosure.distribution, `${path}.disclosure.distribution`),
    },
    gamingFlagCount: requireNumber(v.gamingFlagCount, `${path}.gamingFlagCount`),
    generatedAt: requireString(v.generatedAt, `${path}.generatedAt`),
    specVersion: requireString(v.specVersion, `${path}.specVersion`),
  };
  if (!card.publishable && (card.medianRho !== null || card.ci95 !== null)) {
    fail(
      `${path}.medianRho`,
      'null on a card that is not publishable (SPEC §2.2: below the threshold a card is a state, not a number)',
    );
  }
  return card;
}

const HASH_PATTERN = /^[0-9a-f]{64}$/;

/**
 * The resolution table.
 *
 * Rows are validated the way everything else from the bundle is — this file is
 * UNTRUSTED input typed as `unknown` — and a row that fails is DROPPED rather
 * than thrown on. A malformed ruleset must fail loudly because it decides what
 * gets badged; a malformed resolution row decides only whether one cloak stays
 * unresolved, and unresolved is the honest default we would fall back to
 * anyway. Failing the whole bundle over one bad row would take the badges down
 * with it.
 *
 * A destination that is not an http(s) URL is dropped to null and the row is
 * kept: `status` is still a finding even when the destination is unusable.
 */
export function parseResolutions(v: unknown): Map<string, BundleResolution> {
  const out = new Map<string, BundleResolution>();
  const entries = isRecord(v) ? v.entries : undefined;
  if (!Array.isArray(entries)) return out;
  for (const item of entries) {
    if (!isRecord(item)) continue;
    const { hash, destination, status, observedAt } = item;
    if (typeof hash !== 'string' || !HASH_PATTERN.test(hash)) continue;
    let dest: string | null = null;
    if (typeof destination === 'string' && destination !== '') {
      try {
        const u = new URL(destination);
        if (u.protocol === 'http:' || u.protocol === 'https:') dest = destination;
      } catch {
        dest = null;
      }
    }
    out.set(hash, {
      destination: dest,
      status: typeof status === 'string' ? status : 'unknown',
      observedAt: typeof observedAt === 'string' ? observedAt : '',
    });
  }
  return out;
}

/** Validate a bundle object. Throws on the first violation, with its path. */
export function loadBundle(raw: unknown): LoadedBundle {
  if (!isRecord(raw)) fail('bundle', 'an object');
  const cards = new Map<string, BundleCard>();
  if (!Array.isArray(raw.cards)) fail('bundle.cards', 'an array');
  raw.cards.forEach((entry, i) => {
    const card = parseBundleCard(entry, `bundle.cards[${i}]`);
    cards.set(card.publisher.toLowerCase(), card);
  });
  const notes = Array.isArray(raw.notes)
    ? raw.notes.map((n, i) => requireString(n, `bundle.notes[${i}]`))
    : [];
  // The GATE is the one field that fails closed rather than defaulting.
  // `undefined` here would be an old bundle that predates the table, and the
  // safe reading of "I do not know whether the table is complete" is "assume
  // it is not" — which turns the network fallback ON. That is the direction
  // that keeps a reader informed; the opposite direction would silently claim
  // completeness the file never asserted. It is `!== false` rather than
  // `=== true` for exactly that reason.
  const resolutions = parseResolutions(raw.resolutions);
  const truncated = raw.resolutions_truncated !== false;
  const total = isRecord(raw.resolutions) && typeof raw.resolutions.total === 'number'
    ? raw.resolutions.total
    : resolutions.size;
  return {
    schemaVersion: requireNumber(raw.schemaVersion, 'bundle.schemaVersion'),
    bundleVersion: requireNumber(raw.bundleVersion, 'bundle.bundleVersion'),
    generatedAt: requireString(raw.generatedAt, 'bundle.generatedAt'),
    specVersion: requireString(raw.specVersion, 'bundle.specVersion'),
    sha256: requireString(raw.sha256, 'bundle.sha256'),
    ruleset: parseRuleset(raw.networks),
    cards,
    resolutions,
    resolutionsTruncated: truncated,
    resolutionsTotal: total,
    notes,
  };
}

let memo: LoadedBundle | null = null;

/**
 * The embedded bundle, validated once.
 *
 * LAZY ON PURPOSE. Validating the ruleset and building the matcher is the only
 * non-trivial work this extension does, and it happens on the first idle
 * callback rather than while the page is loading (CLAUDE.md, Performance
 * constraints: zero synchronous work on the main thread during page load).
 */
export function getBundle(): LoadedBundle {
  memo ??= loadBundle(rawBundle);
  return memo;
}

/** The raw embedded JSON, for tests that want to check what shipped. */
export function embeddedBundleJson(): unknown {
  return rawBundle;
}
