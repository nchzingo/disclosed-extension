/**
 * picks.ts — the ranked picks visible on THIS page, and which of them carry a
 * badged link.
 *
 * SCOPE, STATED BEFORE THE CODE. This is a page-level observation for the
 * popup. It is NOT the corpus `m_i` of SPEC §0.1.0 and it never becomes one:
 * the corpus assigns picks from a rendered snapshot with JSON-LD item lists,
 * title self-checks and a recorded `rankBasis` (docs/EXTRACTION.md), and it is
 * that pipeline — not this one — that produces the numbers on a report card.
 * What the popup says, in these words, is how many ranked picks were detected
 * on the page and how many of those carry a link the extension badged.
 *
 * `parsePickNumber` is copied VERBATIM from
 * `packages/crawler/src/extract.ts`, including the guard that made it right:
 * the separator must not be followed by another digit, or a RANGE reads as an
 * ordinal ("5–8.5 in (13–22 cm) screen" produced a phantom pick on the Class A
 * Wikipedia control). Copied rather than imported for the same reason as the
 * disclosure pattern — the crawler depends on Playwright and nothing that
 * ships to a reader may. test/picks.test.ts pins the copy against the same
 * cases the crawler's tests use.
 */

/** VERBATIM from packages/crawler/src/extract.ts. */
export function parsePickNumber(heading: string): number | null {
  const m = /^\s*(?:#\s*|no\.?\s+)?(\d{1,2})\s*[.):\-–—]\s*(?!\d)(.*)$/i.exec(heading);
  if (!m) return null;
  if ((m[2] ?? '').trim().length === 0) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= 99 ? n : null;
}

export interface PagePick {
  /** The rank the publisher stated in the heading. 1 = top. */
  position: number;
  heading: string;
  /** Badged links found between this heading and the next ranked heading. */
  badgedLinks: number;
}

/** Headings examined before we stop looking. Bounded work, always. */
export const MAX_HEADINGS = 400;

/**
 * Ranked picks on the page, in document order, with badged-link counts.
 *
 * A badged link belongs to the NEAREST PRECEDING ranked heading — the same
 * "everything until the next pick" region the crawler's association uses. A
 * badged link above the first ranked heading belongs to no pick and is counted
 * nowhere here (it still counts in the page's badged total, which is the
 * number the popup leads with).
 */
export function collectPicks(doc: Document, badged: readonly Element[]): PagePick[] {
  const headings: { el: Element; pick: PagePick }[] = [];
  const nodes = doc.querySelectorAll('h1, h2, h3, h4, h5, h6');
  for (let i = 0; i < nodes.length && i < MAX_HEADINGS; i++) {
    const el = nodes[i]!;
    const text = (el.textContent ?? '').trim().replace(/\s+/g, ' ');
    const position = parsePickNumber(text);
    if (position === null) continue;
    headings.push({ el, pick: { position, heading: text.slice(0, 120), badgedLinks: 0 } });
  }
  if (headings.length === 0) return [];

  for (const link of badged) {
    // The last heading that PRECEDES this link in document order.
    // DOCUMENT_POSITION_PRECEDING (2) on the heading, viewed from the link.
    let owner: PagePick | null = null;
    for (const h of headings) {
      if ((link.compareDocumentPosition(h.el) & 2) !== 0) owner = h.pick;
      else break;
    }
    if (owner !== null) owner.badgedLinks++;
  }
  return headings.map((h) => h.pick);
}
