/**
 * marker.ts — the mark that goes BESIDE a badged link.
 *
 * HARD RULE 1, IN CODE. Nothing here assigns to `href`, sets any attribute on
 * the anchor, calls `click()`, `window.open()` or `location`, or reads the
 * anchor for any purpose but describing it. The marker is a NEW element
 * inserted into the anchor's PARENT, immediately after the anchor:
 *
 *     parent.insertBefore(marker, anchor.nextSibling)
 *
 * written that way rather than as `anchor.insertAdjacentElement('afterend',…)`
 * because the two do the same thing and only one of them reads, at a glance,
 * as leaving the anchor alone. The anchor's own `outerHTML` is byte-identical
 * before and after — test/hrefs-untouched.test.ts asserts exactly that.
 *
 * The marker never obscures the link: it is an 8px inline dot placed after the
 * anchor's box, it is not positioned, and it carries no layout of its own
 * beyond its own width. Its styles live inside a SHADOW ROOT, so the page's
 * stylesheet cannot restyle or hide it and our styles cannot leak into the
 * page. We do not inject a stylesheet into the document.
 *
 * Filled dot = `confirmed`. Hollow dot = `likely`. `possible` and `none` get
 * no marker, ever (CLAUDE.md tier table; `shouldBadge()` is what decides).
 */
import type { Classification } from '@disclosed/core';

/** Attribute the marker host carries, so a test or a reader can find them. */
export const MARKER_ATTRIBUTE = 'data-disclosed-marker';

const STYLE = `
:host { all: initial; }
.dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  margin: 0 0 0 3px;
  vertical-align: baseline;
  border-radius: 50%;
  border: 1.5px solid #1a5fb4;
  box-sizing: border-box;
}
.dot.confirmed { background: #1a5fb4; }
.dot.likely { background: transparent; }
`;

/**
 * What the marker says when a reader hovers it. Facts only: the tier, the
 * network that matched, the merchant if the link named one, and where the
 * classification happened. No adjective and no verdict (HARD RULE 4).
 */
export function markerTitle(c: Classification): string {
  const parts = [`Disclosed: affiliate link — ${c.tier}`];
  if (c.network !== null) parts.push(`matched "${c.network}" in the rules bundle`);
  if (c.merchant !== null) parts.push(`merchant declared in the link: ${c.merchant}`);
  parts.push('classified on your device; nothing about this page left your browser');
  return `${parts.join('. ')}.`;
}

/** The marker element. Not attached to anything yet. */
export function createMarker(doc: Document, c: Classification): HTMLElement {
  const host = doc.createElement('span');
  host.setAttribute(MARKER_ATTRIBUTE, c.tier);
  host.setAttribute('role', 'img');
  const title = markerTitle(c);
  host.setAttribute('aria-label', title);
  host.setAttribute('title', title);
  const shadow = host.attachShadow({ mode: 'open' });
  const style = doc.createElement('style');
  style.textContent = STYLE;
  const dot = doc.createElement('span');
  dot.setAttribute('class', `dot ${c.tier}`);
  shadow.append(style, dot);
  return host;
}

/**
 * Insert a marker after `anchor`. Returns it, or null when the anchor has no
 * parent to insert into (a detached node — nothing to mark).
 */
export function insertMarker(
  anchor: HTMLAnchorElement,
  c: Classification,
): HTMLElement | null {
  const parent = anchor.parentNode;
  if (parent === null) return null;
  const doc = anchor.ownerDocument;
  const marker = createMarker(doc, c);
  parent.insertBefore(marker, anchor.nextSibling);
  return marker;
}
