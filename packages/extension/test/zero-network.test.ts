/**
 * ZERO NETWORK CALLS — the real content script, the whole corpus fixture, and
 * an API base deliberately configured so the old code path WOULD have fired.
 *
 * ---------------------------------------------------------------------------
 * WHAT CHANGED, AND WHY THIS TEST EXISTS (ruling 2026-09-08)
 *
 * `test/no-network.test.ts` proves the previous claim: a build with no API
 * base makes no request. That was true and it was weaker than it sounded — it
 * held because this repo never configured an API base, not because the
 * extension had nothing to ask. A page full of cloaked links in a build that
 * HAD an API base made one request per page.
 *
 * The resolution table now ships inside the rules bundle, so there is nothing
 * left to ask. This test asserts the strong form of the claim:
 *
 *   - `lib/config.js` is mocked to a build WITH an API base and lookups
 *     enabled — the configuration that used to make the request.
 *   - The page carries EVERY cloaked URL in the corpus fixture, both the ones
 *     the shipped table can answer and the ones it cannot.
 *   - `fetch`, `XMLHttpRequest`, `sendBeacon` AND the message channel to the
 *     background worker are all spied.
 *   - The count of each is exactly zero.
 *
 * The message-channel spy is the one that matters. `fetch` living in the
 * background worker means a content-script test could pass while a request was
 * still being made one process away; `browser.runtime.sendMessage` is where
 * that process boundary is crossed, and nothing may cross it.
 * ---------------------------------------------------------------------------
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getBundle } from '../src/lib/bundle.js';
import { networkFallbackAllowed } from '../src/lib/resolutions.js';
import { MSG_PAGE_REPORT } from '../src/lib/messages.js';
import type { PageReportResponse } from '../src/lib/messages.js';
import { corpusSample } from './helpers.js';

/** The build that used to make a request. */
vi.mock('../src/lib/config.js', () => ({
  API_BASE: 'https://api.disclosed.example',
  LOOKUPS_ENABLED: true,
}));

const sendMessage = vi.fn(() => Promise.resolve({ entries: [] }));
const listeners: ((m: unknown, s: unknown, r: (v: unknown) => void) => boolean)[] = [];

vi.mock('wxt/browser', () => ({
  browser: {
    runtime: {
      sendMessage: (...args: unknown[]) => sendMessage(...(args as [])),
      onMessage: {
        addListener: (fn: (m: unknown, s: unknown, r: (v: unknown) => void) => boolean) => {
          listeners.push(fn);
        },
      },
    },
  },
}));

vi.mock('wxt/utils/define-content-script', () => ({
  defineContentScript: (definition: unknown) => definition,
}));

const PAGE_URL = 'https://nymag.com/strategist/article/best-camping-mattresses.html';

let fetchSpy: ReturnType<typeof vi.fn>;
let xhrOpen: ReturnType<typeof vi.fn>;
let beacon: ReturnType<typeof vi.fn>;
const originals = {
  fetch: globalThis.fetch,
  XMLHttpRequest: globalThis.XMLHttpRequest,
  sendBeacon: globalThis.navigator?.sendBeacon,
  requestIdleCallback: globalThis.requestIdleCallback,
};

beforeEach(() => {
  listeners.length = 0;
  sendMessage.mockClear();
  fetchSpy = vi.fn(() => Promise.reject(new Error('no network in this test')));
  xhrOpen = vi.fn();
  beacon = vi.fn(() => true);
  globalThis.fetch = fetchSpy as unknown as typeof fetch;
  class BlockedXhr {
    open(...args: unknown[]): void {
      xhrOpen(...args);
    }
    send(): void {
      xhrOpen('send');
    }
    setRequestHeader(): void {}
    addEventListener(): void {}
  }
  globalThis.XMLHttpRequest = BlockedXhr as unknown as typeof XMLHttpRequest;
  Object.defineProperty(globalThis.navigator, 'sendBeacon', { value: beacon, configurable: true });
  // Synchronous, so the assertions do not race the scheduler. The production
  // path is `requestIdleCallback` with a timeout; what it defers is the same
  // work this runs now.
  globalThis.requestIdleCallback = ((fn: () => void) => {
    fn();
    return 1;
  }) as unknown as typeof requestIdleCallback;
  Object.defineProperty(document, 'URL', { value: PAGE_URL, configurable: true });
});

afterEach(() => {
  globalThis.fetch = originals.fetch;
  globalThis.XMLHttpRequest = originals.XMLHttpRequest;
  globalThis.requestIdleCallback = originals.requestIdleCallback;
  if (originals.sendBeacon !== undefined) {
    Object.defineProperty(globalThis.navigator, 'sendBeacon', {
      value: originals.sendBeacon,
      configurable: true,
    });
  }
  document.body.innerHTML = '';
});

function anchor(href: string, rel: string | null): string {
  const escaped = href.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  return `<a href="${escaped}"${rel === null ? '' : ` rel="${rel}"`}>link</a>`;
}

/** Every link and every cloak in the fixture, on one page. */
function renderCorpusPage(): { links: number; cloaks: number } {
  const { links, cloaks } = corpusSample();
  document.body.innerHTML = [
    '<h2>1. A ranked pick</h2>',
    ...links.map((l) => anchor(l.href, l.rel)),
    ...cloaks.map((c) => anchor(c.href, c.rel)),
  ].join('\n');
  return { links: links.length, cloaks: cloaks.length };
}

async function runContentScript(): Promise<PageReportResponse | null> {
  const mod = (await import('../src/entrypoints/content.js')) as {
    default: { main: () => void };
  };
  mod.default.main();
  // Let any promise the script started settle before we look.
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  let payload: PageReportResponse | null = null;
  for (const fn of listeners) {
    fn({ type: MSG_PAGE_REPORT }, null, (v: unknown) => {
      if (v !== null) payload = v as PageReportResponse;
    });
  }
  return payload;
}

describe('the shipped resolution table', () => {
  it('is complete, so the network fallback is closed', () => {
    const bundle = getBundle();
    expect(bundle.resolutionsTruncated).toBe(false);
    expect(networkFallbackAllowed(bundle)).toBe(false);
    // The flag is not trusted on its own: shipped must equal held.
    expect(bundle.resolutions.size).toBe(bundle.resolutionsTotal);
    expect(bundle.resolutions.size).toBeGreaterThan(1000);
  });

  it('carries a destination for some rows and a stated reason for the rest', () => {
    const rows = [...getBundle().resolutions.values()];
    const withDestination = rows.filter((r) => r.destination !== null);
    const refused = rows.filter((r) => r.destination === null);
    expect(withDestination.length).toBeGreaterThan(0);
    expect(refused.length).toBeGreaterThan(0);
    // Every row without a destination says WHY. `robots_disallowed`, `blocked`
    // and `not_a_redirect` are three findings and are never one silence.
    for (const r of refused) {
      expect(r.status).not.toBe('resolved');
      expect(r.status.length).toBeGreaterThan(0);
    }
  });
});

describe('the real content script over the whole corpus fixture', () => {
  it('makes ZERO network calls with an API base configured and the page full of cloaks', async () => {
    const { links, cloaks } = renderCorpusPage();
    expect(cloaks).toBeGreaterThan(0);

    const payload = await runContentScript();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(xhrOpen).not.toHaveBeenCalled();
    expect(beacon).not.toHaveBeenCalled();
    // The process boundary. Nothing crossed it, so the background worker was
    // never asked for a bucket and never had a prefix to send.
    expect(sendMessage).not.toHaveBeenCalled();

    // …and the page really was the hard case: links were classified, cloaks
    // were pended, and the embedded table answered some of them. A zero-call
    // result on a page with nothing to look up would prove nothing.
    expect(payload).not.toBeNull();
    const report = payload!.report;
    expect(report.anchorsExamined).toBe(links + cloaks);
    expect(report.badgedConfirmed + report.badgedLikely).toBeGreaterThan(0);
    expect(report.cloaksAnsweredFromBundle).toBeGreaterThan(0);
  });

  it('answers cloaks from the table and keeps a refusal apart from an unknown', async () => {
    renderCorpusPage();
    const payload = await runContentScript();
    const report = payload!.report;

    // Three buckets, and every cloak on the page is in exactly one:
    //  - answered with a destination (some of which badge),
    //  - answered with a REASON we could not resolve it (an operator refused),
    //  - never looked at.
    expect(report.cloakRefusedByOperator).toBeGreaterThan(0);
    expect(report.cloakedUnresolved).toBeGreaterThan(0);
    // `cloaksAnsweredFromBundle` counts URLs; the two badge counters count
    // ANCHORS, and one URL can appear on several. So the relation is `>=`,
    // and asserting equality would be asserting that the corpus fixture
    // happens to carry no repeated href.
    const withDestination = report.cloaksAnsweredFromBundle - report.cloakRefusedByOperator;
    expect(withDestination).toBeGreaterThan(0);
    expect(report.resolutionsApplied + report.resolvedNotBadged).toBeGreaterThanOrEqual(
      withDestination,
    );
    expect(sendMessage).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
