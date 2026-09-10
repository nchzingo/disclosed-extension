/**
 * messages.ts — the two messages this extension sends between its own parts.
 *
 * The payloads are the privacy boundary, so they are declared in one file
 * where they can be read together:
 *
 *  - `disclosed:page-report` — popup asks the content script what it found on
 *    the page the reader is already looking at. The report crosses from the
 *    page's own tab to the popup and goes nowhere else.
 *  - `disclosed:resolve` — content script asks the background worker to fetch
 *    some k-anonymity buckets. **The payload is a list of five-character hex
 *    prefixes and nothing else.** No URL, no host, no title, no tab id, no
 *    count of what is on the page. The background worker could not identify
 *    the page if it wanted to.
 */
import type { ResolutionEntry } from './kanon.js';
import type { PageReport } from './scan.js';

export const MSG_PAGE_REPORT = 'disclosed:page-report';
export const MSG_RESOLVE = 'disclosed:resolve';

export interface PageReportRequest {
  type: typeof MSG_PAGE_REPORT;
}

export interface PageReportResponse {
  report: PageReport;
  bundle: { version: number; generatedAt: string; specVersion: string; sha256: string };
  /** True when this build has no API base at all. See lib/config.ts. */
  lookupsDisabled: boolean;
}

export interface ResolveRequest {
  type: typeof MSG_RESOLVE;
  /** Five hex characters each. The background re-validates before sending. */
  prefixes: string[];
}

export interface ResolveResponse {
  entries: ResolutionEntry[];
}

export type Message = PageReportRequest | ResolveRequest;
