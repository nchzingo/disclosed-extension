/**
 * background.ts — the only process in this extension that can reach the
 * network, and it can only reach one endpoint.
 *
 * It receives a list of five-hex-character prefixes from a content script and
 * fetches the matching k-anonymity buckets. It never receives a URL, a host, a
 * title or a tab id, and it never asks for one — the message type carries a
 * `string[]` of prefixes and nothing else (lib/messages.ts). Every prefix is
 * RE-VALIDATED here against `/^[0-9a-f]{5}$/` before it can reach a request
 * path, because a boundary that trusts the other side of itself is not a
 * boundary.
 *
 * ONE ATTEMPT PER PAGE, no retries, no backoff loop. A build with no API base
 * — which is every build this repo produces — returns an empty answer without
 * touching `fetch` at all.
 */
import { defineBackground } from 'wxt/utils/define-background';
import { browser } from 'wxt/browser';
import { API_BASE, LOOKUPS_ENABLED } from '../lib/config.js';
import { fetchPrefix, MAX_PREFIXES_PER_PAGE, PREFIX_PATTERN } from '../lib/kanon.js';
import { MSG_RESOLVE, type Message, type ResolveResponse } from '../lib/messages.js';

async function resolve(prefixes: readonly unknown[]): Promise<ResolveResponse> {
  if (!LOOKUPS_ENABLED) return { entries: [] };
  const valid = [
    ...new Set(
      prefixes.filter((p): p is string => typeof p === 'string' && PREFIX_PATTERN.test(p)),
    ),
  ].slice(0, MAX_PREFIXES_PER_PAGE);
  if (valid.length === 0) return { entries: [] };
  const responses = await Promise.all(
    valid.map((prefix) => fetchPrefix(prefix, { apiBase: API_BASE, fetchImpl: fetch })),
  );
  return { entries: responses.flat() };
}

export default defineBackground(() => {
  browser.runtime.onMessage.addListener(
    (message: unknown, _sender: unknown, sendResponse: (response: unknown) => void) => {
      const msg = message as Message | undefined;
      if (msg?.type !== MSG_RESOLVE) return false;
      const prefixes = Array.isArray(msg.prefixes) ? msg.prefixes : [];
      void resolve(prefixes).then(sendResponse);
      // Keep the message channel open for the async answer.
      return true;
    },
  );
});
