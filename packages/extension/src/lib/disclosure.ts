/**
 * disclosure.ts — is there a disclosure on this page, and where is it?
 *
 * A FACT, NOT A GRADE. The card's disclosure grade (SPEC §1.5) is computed
 * over a whole publisher from a harvested corpus and travels in the bundle;
 * what this file produces is one observation about the page in front of the
 * reader: disclosure-looking text was found at this position relative to the
 * first badged link, or it was not found. No adjective, no letter, no verdict
 * (HARD RULE 4).
 *
 * The pattern list is copied VERBATIM from
 * `packages/crawler/src/extract.ts` (`DISCLOSURE_REGEX_SOURCE`) so the
 * extension recognises exactly the strings the corpus recognises. It is copied
 * rather than imported because `@disclosed/crawler` depends on Playwright and
 * nothing that ships to a reader's browser may. If the crawler's list changes,
 * this one is changed with it — the test in test/disclosure.test.ts asserts
 * the two strings are identical, so the copy cannot drift unnoticed.
 */

/** VERBATIM from packages/crawler/src/extract.ts — see the note above. */
export const DISCLOSURE_REGEX_SOURCE =
  '(affiliate (link|links|commission|partnership)' +
  '|we (may )?(earn|receive|get) (a )?(commission|compensation)' +
  '|earns? from qualifying purchases' +
  '|paid links?' +
  '|compensat(ed|ion) (from|by|when)' +
  '|commission (if|when) you (buy|purchase|click))';

const DISCLOSURE_RE = new RegExp(DISCLOSURE_REGEX_SOURCE, 'i');

export function isDisclosureText(text: string): boolean {
  return DISCLOSURE_RE.test(text);
}

/**
 * Where the disclosure sits relative to the first badged link.
 *
 * `null` for `beforeFirstBadgedLink` means the question does not arise: no
 * link on this page was badged, so there is no first badged link to be above
 * or below. That is a third state and it is reported as one rather than
 * collapsed into `false`.
 */
export interface DisclosureFinding {
  snippet: string;
  beforeFirstBadgedLink: boolean | null;
  inFooter: boolean;
}

/** Text nodes examined before we stop looking. Bounded work, always. */
export const MAX_TEXT_NODES = 5000;
const MAX_SNIPPET = 200;

function inFooter(node: Node): boolean {
  for (let el = node.parentElement; el !== null; el = el.parentElement) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'footer') return true;
    if (el.getAttribute('role') === 'contentinfo') return true;
  }
  return false;
}

/**
 * The first disclosure-looking text node in document order, or null.
 *
 * `firstBadged` is the first anchor this page's scan badged, or null if none
 * was. Position is decided with `compareDocumentPosition`, which is the
 * browser's own document-order answer rather than a coordinate we computed.
 */
export function findDisclosure(
  doc: Document,
  firstBadged: Element | null,
  maxNodes: number = MAX_TEXT_NODES,
): DisclosureFinding | null {
  const body = doc.body;
  if (body === null) return null;
  const walker = doc.createTreeWalker(body, 0x4 /* NodeFilter.SHOW_TEXT */);
  let seen = 0;
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (++seen > maxNodes) return null;
    const text = node.nodeValue;
    if (text === null || text.length < 12 || !isDisclosureText(text)) continue;
    const snippet = text.trim().replace(/\s+/g, ' ').slice(0, MAX_SNIPPET);
    let before: boolean | null = null;
    if (firstBadged !== null) {
      // DOCUMENT_POSITION_FOLLOWING (4): the badged link comes after the
      // disclosure, i.e. the disclosure is above it.
      before = (node.compareDocumentPosition(firstBadged) & 4) !== 0;
    }
    return { snippet, beforeFirstBadgedLink: before, inFooter: inFooter(node) };
  }
  return null;
}
