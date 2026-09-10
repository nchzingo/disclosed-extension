/**
 * gated-bundle.mjs — what we withhold from a bundle before it leaves this
 * repository, in ONE place.
 *
 * Two artefacts ship the rules bundle to strangers: the public
 * `disclosed-extension` repository (`ops/split-extension.mjs`) and the Chrome
 * Web Store package (`tools/store-bundle.mjs`). Both have to withhold the same
 * class of thing for the same reason, and until this module existed each decided
 * for itself — which is how they came to differ without anyone noticing.
 *
 * WHAT MAY BE WITHHELD, AND WHY EACH IS A SEPARATE CHOICE.
 *
 *   cards        A summary per publisher: monetization exposure, disclosure
 *                grade distribution, whether a correlation is published. These
 *                are measurements about named companies, and SPEC-scoring.md §9
 *                gives every one of them seven days' written notice before
 *                anything about them is published. A public repository is
 *                publication. So is a store listing.
 *
 *   resolutions  Where cloaked links go, keyed by `sha256(url)` and containing
 *                no URL. Weaker than a card — nobody can enumerate the list from
 *                the file, and a row records our own observation rather than a
 *                figure about a publisher — but it is still derived from
 *                crawling publishers' links, and withholding it costs nothing
 *                the store needs.
 *
 * THE TWO CALLERS DELIBERATELY DIFFER, AND THAT IS NOT AN OVERSIGHT.
 *
 *   public repo    withholds `cards`. It KEEPS the resolution table, because the
 *                  repository exists so a reader can verify the zero-network
 *                  claim, and the strongest form of that demonstration is
 *                  `verify-built` answering a real cloak out of the shipped
 *                  bytes without asking anybody.
 *   store package  withholds `cards` AND `resolutions`. A store listing is read
 *                  by nobody auditing anything; it is a binary a user installs.
 *                  Withholding more costs nothing there, and a listing that
 *                  embeds no publisher measurement is not publication at all.
 *
 * THE HASH IS ALWAYS RECOMPUTED. `sha256` covers the bundle body with the
 * `sha256` field removed, so a reduced bundle still verifies against its own
 * stated hash rather than carrying one that is quietly wrong. `verifyBundleHash`
 * in the crawler is the other half of that contract.
 */
import { createHash } from 'node:crypto';

/** sha256 over the bundle with its own `sha256` field removed. */
export function bundleHash(bundle) {
  const { sha256: _drop, ...body } = bundle;
  return createHash('sha256').update(JSON.stringify(body)).digest('hex');
}

const NOTES = {
  cards:
    'PUBLISHER CARDS WITHHELD FROM THIS COPY. The cards summarise measurements about named ' +
    'publishers, and SPEC-scoring.md §9 gives every publisher seven days written notice before ' +
    'anything about it is published. This bundle is otherwise identical to the one built in the ' +
    'source repository; its sha256 has been recomputed over the reduced body, so it still ' +
    'verifies. Every site will report "no report card", which is accurate: none has been published.',
  resolutions:
    'RESOLUTION TABLE WITHHELD FROM THIS COPY. The table records where cloaked links go, keyed by ' +
    'sha256(url) and containing no URL. It is withheld here because nothing in this artefact needs ' +
    'it and it is derived from crawling publishers’ links. A cloaked link is therefore shown as ' +
    'cloaked with an unknown destination — never as unmonetized — which is the same honest ' +
    'default the table itself produces for a row it does not hold.',
};

/**
 * Apply the gating and return the reduced bundle.
 *
 * `withhold` is an explicit list, never a default: a caller that has not decided
 * what it is withholding has not thought about what it is publishing.
 */
export function gateBundle(raw, withhold) {
  if (!Array.isArray(withhold) || withhold.length === 0) {
    throw new Error('gateBundle: `withhold` must name what is being withheld, explicitly');
  }
  const unknown = withhold.filter((w) => !(w in NOTES));
  if (unknown.length > 0) throw new Error(`gateBundle: nothing known as ${unknown.join(', ')}`);

  const out = { ...raw, notes: [...(raw.notes ?? [])] };
  const withheld = {};

  if (withhold.includes('cards')) {
    withheld.cards = raw.cards.length;
    out.cards = [];
    out.notes.push(NOTES.cards);
  }
  if (withhold.includes('resolutions')) {
    withheld.resolutions = raw.resolutions.entries.length;
    // `shipped` and `total` both go to zero. `resolutions_truncated` stays
    // FALSE, and the distinction is load-bearing: truncated means the table was
    // too large to ship and a client may fall back to the network. An empty
    // table is not truncated, it is absent, and the client must still make no
    // request. Setting it true here would hand the extension a host permission.
    out.resolutions = { ...raw.resolutions, total: 0, shipped: 0, entries: [] };
    out.resolutions_truncated = false;
    out.notes.push(NOTES.resolutions);
  }

  return { bundle: { ...out, sha256: bundleHash({ ...out, sha256: '' }) }, withheld };
}

/**
 * The `lookup-gate.json` that goes with a gated bundle.
 *
 * The gate file pins the bundle's hash and its shipped row count, and a test
 * asserts the two agree. Reducing the bundle without rewriting this leaves an
 * artefact whose two halves describe different files.
 */
export function gatedLookupGate(gate, bundle) {
  return {
    ...gate,
    bundleSha256: bundle.sha256,
    resolutions_truncated: bundle.resolutions_truncated,
    resolutionsShipped: bundle.resolutions.shipped,
  };
}
