/**
 * content.ts — the content script. It reads the page and marks links. It has
 * never written to one and the tests are what keep it that way.
 *
 * SCHEDULING (CLAUDE.md, Performance constraints):
 *  - Zero work at injection. The bundle is validated and the matcher compiled
 *    inside the first idle callback, not at module load.
 *  - `requestIdleCallback` with a timeout, so the first pass happens when the
 *    page is done with the main thread — or after two seconds, whichever comes
 *    first, because a page that never idles must still be disclosed.
 *  - A debounced `MutationObserver` covers links added after load (infinite
 *    scroll, hydration). Re-scans are capped and each one only visits anchors
 *    the `WeakSet` has not already seen.
 *  - `maxLinks` caps the whole page. When it bites, the report says so.
 *
 * NETWORK: NONE. Not "none by default" — none.
 *
 * Cloaked links are answered from the resolution table embedded in the rules
 * bundle (lib/resolutions.ts, ruling 2026-09-08). The k-anonymity request to
 * `/v1/resolve` fires only if the bundle says its table shipped TRUNCATED, and
 * `resolutions_truncated` is false at this corpus size — so the branch below
 * is dormant, the manifest carries no host permission to make the request
 * with, and the count of network calls this content script makes on any page
 * is zero. `test/no-network.test.ts` asserts it over the corpus fixture with
 * an API base configured, which is the case that used to make a request.
 */
import { defineContentScript } from 'wxt/utils/define-content-script';
import { browser } from 'wxt/browser';
import { getBundle, type BundleResolution } from '../lib/bundle.js';
import { API_BASE, LOOKUPS_ENABLED } from '../lib/config.js';
import { matchEntries, prefixesFor } from '../lib/kanon.js';
import { answerLocally, networkFallbackAllowed } from '../lib/resolutions.js';
import {
  MSG_PAGE_REPORT,
  MSG_RESOLVE,
  type Message,
  type PageReportResponse,
  type ResolveResponse,
} from '../lib/messages.js';
import { buildPrefilter } from '../lib/prefilter.js';
import { Scanner, type PageReport } from '../lib/scan.js';

/** Debounce for DOM mutations, in ms. */
const MUTATION_DEBOUNCE_MS = 500;
/** Re-scans after the first. A bound on pathological pages, not a policy. */
const MAX_RESCANS = 20;
/** How long we let the browser stay busy before scanning anyway. */
const IDLE_TIMEOUT_MS = 2000;

export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  runAt: 'document_idle',
  main() {
    let scanner: Scanner | null = null;
    let bundleRejected = false;
    let report: PageReport | null = null;
    let rescans = 0;
    let lookupAttempted = false;
    let bundleMeta = { version: 0, generatedAt: '', specVersion: '', sha256: '' };

    const onIdle = (fn: () => void): void => {
      if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(() => fn(), { timeout: IDLE_TIMEOUT_MS });
      } else {
        setTimeout(fn, 0);
      }
    };

    /**
     * Build the scanner, once. A bundle that fails validation badges NOTHING
     * and says so in the console: failing closed is the only failure mode a
     * precision-critical classifier may have (CLAUDE.md HARD RULE 3).
     */
    const ensureScanner = (): Scanner | null => {
      if (scanner !== null || bundleRejected) return scanner;
      try {
        const bundle = getBundle();
        bundleMeta = {
          version: bundle.bundleVersion,
          generatedAt: bundle.generatedAt,
          specVersion: bundle.specVersion,
          sha256: bundle.sha256,
        };
        scanner = new Scanner(document, {
          ruleset: bundle.ruleset,
          prefilter: buildPrefilter(bundle.ruleset),
        });
      } catch (error) {
        bundleRejected = true;
        console.error('[disclosed] rules bundle rejected; nothing will be marked', error);
      }
      return scanner;
    };

    /**
     * Answer this page's cloaks from the table we shipped with. No network,
     * no message to the background worker, no prefix, nothing leaves.
     *
     * Runs on every scan, including re-scans after a mutation, because a page
     * that added links after load has new cloaks and answering them costs a
     * hash and a `Map.get` each.
     */
    const answerCloaksFromBundle = (active: Scanner): void => {
      const pending = active.pendingCloaks();
      if (pending.length === 0) return;
      let table: ReadonlyMap<string, BundleResolution>;
      try {
        table = getBundle().resolutions;
      } catch {
        return; // a bundle we already refused; ensureScanner has said so
      }
      active.applyLocalAnswers(answerLocally(pending, table));
    };

    /**
     * The k-anonymity fallback — DORMANT, and gated on the bundle rather than
     * on this build's configuration.
     *
     * It fires only when the bundle says its resolution table shipped
     * incomplete. While the whole table ships, `networkFallbackAllowed` is
     * false and this function returns before it can reach the message channel,
     * regardless of `WXT_API_BASE`. See lib/resolutions.ts for why that gate
     * is worth more than the k-anonymity property it replaces.
     */
    const lookupCloaks = async (active: Scanner): Promise<void> => {
      if (lookupAttempted) return;
      let allowed: boolean;
      try {
        allowed = networkFallbackAllowed(getBundle());
      } catch {
        return;
      }
      if (!allowed || !LOOKUPS_ENABLED) return;
      const pending = active.pendingCloaks();
      if (pending.length === 0) return;
      lookupAttempted = true;
      // The URLs stay here. Only `prefixes` crosses to the background worker.
      const { prefixes, byHash } = prefixesFor(pending);
      try {
        const response = (await browser.runtime.sendMessage({
          type: MSG_RESOLVE,
          prefixes,
        })) as ResolveResponse | undefined;
        if (response === undefined) return;
        active.applyResolutions(matchEntries(byHash, response.entries));
        report = active.report();
      } catch {
        // Silent, per lib/kanon.ts. An unbadged link is the honest state.
      }
    };

    const runScan = (): void => {
      const active = ensureScanner();
      if (active === null) return;
      active.scan();
      // The embedded table first, always. It is the only source of answers at
      // this corpus size, and it is not a request.
      answerCloaksFromBundle(active);
      report = active.report();
      void lookupCloaks(active);
    };

    onIdle(runScan);

    let debounce: ReturnType<typeof setTimeout> | null = null;
    const observer = new MutationObserver(() => {
      if (rescans >= MAX_RESCANS) {
        observer.disconnect();
        return;
      }
      if (debounce !== null) clearTimeout(debounce);
      debounce = setTimeout(() => {
        rescans++;
        onIdle(runScan);
      }, MUTATION_DEBOUNCE_MS);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });

    // The popup asks what was found. If the first idle pass has not run yet,
    // it runs now — the reader has explicitly asked, so the work is theirs.
    browser.runtime.onMessage.addListener(
      (message: unknown, _sender: unknown, sendResponse: (response: unknown) => void) => {
        if ((message as Message | undefined)?.type !== MSG_PAGE_REPORT) return false;
        if (report === null) runScan();
        const payload: PageReportResponse | null =
          report === null
            ? null
            : { report, bundle: bundleMeta, lookupsDisabled: API_BASE === '' };
        sendResponse(payload);
        return false;
      },
    );
  },
});
