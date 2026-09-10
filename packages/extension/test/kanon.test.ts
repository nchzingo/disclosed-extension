/**
 * MANDATORY TEST 4 — the k-anonymity request carries exactly five characters
 * and no other page context.
 *
 * CLAUDE.md, Privacy architecture point 2 and HARD RULE 6: "We never receive
 * browsing history. This is not a compliance checkbox. It is the product."
 * The whole of that claim rests on what this request contains, so this test
 * takes the request apart: the path, the query string, the headers and the
 * body are each checked for the URL, its host, its path and its full hash.
 *
 * It also checks the shape of the request itself — GET, no body, no headers —
 * because a header is a place a URL can hide, and a body is a place a URL can
 * hide quietly.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  fetchPrefix,
  hashOf,
  MAX_PREFIXES_PER_PAGE,
  parseEntries,
  prefixOf,
  PREFIX_LENGTH,
  PREFIX_PATTERN,
  resolveUrls,
} from '../src/lib/kanon.js';

const API = 'https://api.disclosed.info';
const SECRET_URL = 'https://nymag.com/strategist/article/best-headphones.html?utm_source=x';

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

/** Everything that left the browser, flattened into one string. */
function requestText(call: [unknown, unknown]): string {
  return JSON.stringify(call);
}

describe('the k-anonymity request', () => {
  it('sends five hex characters as the whole of the path, and nothing else', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(jsonResponse({ entries: [] })));
    await resolveUrls([SECRET_URL], { apiBase: API, fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const call = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const [url, init] = call;

    expect(url).toMatch(new RegExp(`^${API.replace(/[.]/g, '\\.')}/v1/resolve/[0-9a-f]{5}$`));
    const requested = new URL(url);
    expect(requested.search).toBe('');
    expect(requested.hash).toBe('');
    expect(requested.pathname.split('/').pop()).toHaveLength(PREFIX_LENGTH);

    // The method carries no body, and we set no headers at all.
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
    expect(init.headers).toBeUndefined();
    expect(init.credentials).toBe('omit');
    expect(init.referrerPolicy).toBe('no-referrer');

    // Nowhere in the request — path, query, headers, body — is the URL, its
    // host, its path, or its full hash.
    const text = requestText(call);
    const fullHash = hashOf(SECRET_URL);
    expect(text).not.toContain(SECRET_URL);
    expect(text).not.toContain('nymag.com');
    expect(text).not.toContain('best-headphones');
    expect(text).not.toContain(fullHash);
    // The five characters that DO appear are the first five of that hash.
    expect(requested.pathname.endsWith(fullHash.slice(0, PREFIX_LENGTH))).toBe(true);
  });

  it('completes the match locally: the server is never told which entry we wanted', async () => {
    const fullHash = hashOf(SECRET_URL);
    const decoys = ['a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64)];
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        jsonResponse({
          entries: [
            ...decoys.map((hash) => ({ hash, destination: 'https://decoy.example/x' })),
            { hash: fullHash, destination: 'https://www.amazon.com/dp/B01?tag=nymag-20' },
          ],
        }),
      ),
    );

    const resolved = await resolveUrls([SECRET_URL], {
      apiBase: API,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(resolved.get(SECRET_URL)).toBe('https://www.amazon.com/dp/B01?tag=nymag-20');
    // One request, and no second request telling the server which one matched.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('refuses to put anything but a validated five-hex prefix in a path', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(jsonResponse({ entries: [] })));
    const opts = { apiBase: API, fetchImpl: fetchImpl as unknown as typeof fetch };
    for (const bad of ['', 'abcd', 'abcdef', 'ABCDE', 'ab/cd', 'zzzzz', '../..', 'ab cd']) {
      expect(await fetchPrefix(bad, opts)).toEqual([]);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('makes no request at all when no API base is configured', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(jsonResponse({ entries: [] })));
    const opts = { apiBase: '', fetchImpl: fetchImpl as unknown as typeof fetch };
    expect(await fetchPrefix(prefixOf(SECRET_URL), opts)).toEqual([]);
    expect((await resolveUrls([SECRET_URL], opts)).size).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('degrades silently and does not retry when the API is unreachable', async () => {
    const fetchImpl = vi.fn(() => Promise.reject(new Error('offline')));
    const resolved = await resolveUrls([SECRET_URL], {
      apiBase: API,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(resolved.size).toBe(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('caps how many buckets one page may ask about', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(jsonResponse({ entries: [] })));
    const urls = Array.from({ length: 200 }, (_, i) => `https://cloak.example/go/${i}`);
    await resolveUrls(urls, { apiBase: API, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(fetchImpl.mock.calls.length).toBeLessThanOrEqual(MAX_PREFIXES_PER_PAGE);
  });

  it('drops malformed entries rather than trusting the server', () => {
    expect(parseEntries(null)).toEqual([]);
    expect(parseEntries({ entries: 'nope' })).toEqual([]);
    expect(
      parseEntries({
        entries: [
          { hash: 'short', destination: 'https://ok.example' },
          { hash: 'a'.repeat(64), destination: 'javascript:alert(1)' },
          { hash: 'b'.repeat(64), destination: 'https://ok.example/x' },
        ],
      }),
    ).toEqual([{ hash: 'b'.repeat(64), destination: 'https://ok.example/x' }]);
  });

  it('prefixes are exactly the first five characters of the SHA-256', () => {
    const prefix = prefixOf(SECRET_URL);
    expect(prefix).toHaveLength(5);
    expect(PREFIX_PATTERN.test(prefix)).toBe(true);
    expect(hashOf(SECRET_URL).startsWith(prefix)).toBe(true);
  });
});
