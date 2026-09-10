/**
 * MANDATORY TEST 3 — a page whose links the bundle can classify produces
 * ZERO network requests.
 *
 * CLAUDE.md, Privacy architecture: "The extension operates with zero network
 * calls for 90%+ of links." This test holds the floor under that claim by
 * mocking every way a page-side script can reach the network — `fetch`,
 * `XMLHttpRequest`, `navigator.sendBeacon` — and asserting the count is
 * exactly zero, not "small".
 *
 * It also asserts the stronger property that this repo's builds actually have:
 * with no API base configured, the k-anonymity path returns before it touches
 * `fetch` even when the page IS full of cloaked links it cannot classify. A
 * default build is not merely unwilling to make a request; wxt.config.ts gives
 * it no host permission with which to make one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { API_BASE, LOOKUPS_ENABLED } from '../src/lib/config.js';
import { describePublisher } from '../src/lib/cards.js';
import { resolveUrls } from '../src/lib/kanon.js';
import { describePage } from '../src/lib/panel.js';
import { bundle, page, scan } from './helpers.js';

interface NetworkSpies {
  fetch: ReturnType<typeof vi.fn>;
  xhrOpen: ReturnType<typeof vi.fn>;
  beacon: ReturnType<typeof vi.fn>;
  total(): number;
}

let spies: NetworkSpies;
const originals = {
  fetch: globalThis.fetch,
  XMLHttpRequest: globalThis.XMLHttpRequest,
  sendBeacon: globalThis.navigator?.sendBeacon,
};

beforeEach(() => {
  const fetchSpy = vi.fn(() => Promise.reject(new Error('no network in this test')));
  const xhrOpen = vi.fn();
  const beacon = vi.fn(() => true);
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
  Object.defineProperty(globalThis.navigator, 'sendBeacon', {
    value: beacon,
    configurable: true,
  });
  spies = {
    fetch: fetchSpy,
    xhrOpen,
    beacon,
    total: () => fetchSpy.mock.calls.length + xhrOpen.mock.calls.length + beacon.mock.calls.length,
  };
});

afterEach(() => {
  globalThis.fetch = originals.fetch;
  globalThis.XMLHttpRequest = originals.XMLHttpRequest;
  if (originals.sendBeacon !== undefined) {
    Object.defineProperty(globalThis.navigator, 'sendBeacon', {
      value: originals.sendBeacon,
      configurable: true,
    });
  }
});

describe('no network request on a bundle-classifiable page', () => {
  it('scans, badges and reports without touching fetch, XHR or sendBeacon', async () => {
    const doc = page(`
      <h2>1. Sony WH-1000XM5</h2>
      <a href="https://www.amazon.com/dp/B0123?tag=disclosed-20">Amazon</a>
      <a href="https://goto.walmart.com/c/12/34/56">Walmart</a>
      <a href="https://example.com/go/sony" rel="sponsored">Direct</a>
      <a href="https://www.bose.com/qc?ref=example">Bose</a>
      <a href="https://en.wikipedia.org/wiki/Headphones">Wikipedia</a>
    `);
    const { report, scanner } = scan(doc);
    expect(report.badgedConfirmed + report.badgedLikely).toBeGreaterThan(0);
    // Nothing on this page needs resolving, so there is nothing to look up.
    expect(scanner.pendingCloaks()).toHaveLength(0);

    // The popup's two panels are rendered from the same in-memory data.
    describePage(report);
    describePublisher('example.com', bundle.cards);

    expect(spies.fetch).not.toHaveBeenCalled();
    expect(spies.xhrOpen).not.toHaveBeenCalled();
    expect(spies.beacon).not.toHaveBeenCalled();
    expect(spies.total()).toBe(0);
  });

  it('makes no request even for cloaked links, because this build has no API base', async () => {
    expect(API_BASE).toBe('');
    expect(LOOKUPS_ENABLED).toBe(false);

    const doc = page(`
      <a href="https://amzn.to/3abcdef">Short</a>
      <a href="https://otherblog.example.org/recommends/thing">Cloak</a>
    `);
    const { scanner } = scan(doc);
    expect(scanner.pendingCloaks().length).toBeGreaterThan(0);

    const resolved = await resolveUrls(scanner.pendingCloaks(), {
      apiBase: API_BASE,
      fetchImpl: globalThis.fetch,
    });
    expect(resolved.size).toBe(0);
    expect(spies.total()).toBe(0);
  });
});
