/**
 * resolutions.ts — answering a cloak from the table this extension already
 * shipped with, and the reason that answer is not a network request.
 *
 * ---------------------------------------------------------------------------
 * THE RULING, 2026-09-08: SHIP THE TABLE.
 *
 * The k-anonymity endpoint exists because a resolution table was assumed to be
 * too large to hand every reader. It is not. The whole corpus of observed
 * resolutions serializes to a few hundred KiB inside a bundle that already
 * ships weekly, so it ships INSIDE the bundle, hash-keyed, and the lookup
 * happens against a `Map` in this process.
 *
 * What that buys is not speed. It is the difference between "the server cannot
 * learn which URL you asked about" and **"there is no server and no request"**.
 * CLAUDE.md's privacy architecture measured the first claim on 2026-09-07 and
 * found the anonymity set was a crowd of one for 1,145 of 1,146 prefixes — a
 * mechanism whose privacy property arrives at scale and had not arrived. This
 * removes the need for the property rather than waiting for it.
 *
 * `/v1/resolve` is not deleted. It becomes the documented fallback for a table
 * too large to ship, gated on one flag — `resolutions_truncated` — which the
 * bundle builder sets and which is FALSE today. See `networkFallbackAllowed`.
 * ---------------------------------------------------------------------------
 *
 * NOTHING HERE TOUCHES THE NETWORK. There is no `fetch` in this file, no
 * import that reaches one, and no code path that could acquire one. It reads a
 * map.
 */
import { sha256Hex } from '@disclosed/core/canonical';
import type { BundleResolution, LoadedBundle } from './bundle.js';

/** What the embedded table says about one cloaked URL on the page. */
export interface LocalAnswer extends BundleResolution {
  /** The URL as it appeared in the document. Never leaves this process. */
  url: string;
}

/**
 * Look up every pending cloak in the embedded table.
 *
 * The URLs are hashed HERE and the hashes are matched HERE. Both halves stay
 * in the content script's own memory; nothing is sent anywhere, so there is no
 * prefix, no bucket and no crowd to be a crowd of one.
 *
 * A URL the table does not hold is simply absent from the result: it stays
 * "cloaked, destination unknown", which is the state the corpus itself uses
 * for an unresolved cloak (docs/LABELING.md §3).
 */
export function answerLocally(
  urls: readonly string[],
  table: ReadonlyMap<string, BundleResolution>,
): Map<string, LocalAnswer> {
  const out = new Map<string, LocalAnswer>();
  if (table.size === 0) return out;
  for (const url of urls) {
    const row = table.get(sha256Hex(url));
    if (row !== undefined) out.set(url, { ...row, url });
  }
  return out;
}

/**
 * **The network gate. This is the whole of the decision.**
 *
 * True only when the bundle says its resolution table shipped incomplete. At
 * the current corpus size it is false, and a false answer here means this
 * extension makes zero network calls — not "few", not "only for cloaks",
 * zero — whatever `WXT_API_BASE` was set to at build time.
 *
 * The build enforces the same thing one layer down and in a way this process
 * cannot override: `wxt.config.ts` grants the API origin a `host_permission`
 * only when this flag is true, so while the table ships whole the browser
 * itself will refuse the request. A gate that lives only in a branch is a gate
 * one refactor away from being open.
 */
export function networkFallbackAllowed(bundle: LoadedBundle): boolean {
  return bundle.resolutionsTruncated;
}
