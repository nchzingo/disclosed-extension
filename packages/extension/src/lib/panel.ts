/**
 * panel.ts — the page half of the popup, in words, with no DOM involved.
 *
 * Separated from the popup so the sentences can be tested. Every one of them
 * is a statement about what happened on this page: how many links were marked,
 * how many were examined, what was NOT marked and why. No adjectives, no
 * verdicts, and nothing said about the publisher — that is the card's job
 * (lib/cards.ts) and the two are never blended.
 *
 * The awkward numbers are deliberately here rather than omitted:
 *  - a scan that hit its link cap says so, because a truncated scan reporting
 *    a clean page would be an exoneration we did not earn;
 *  - `possible` links are counted and named as never-badged, because the
 *    reader is entitled to know we saw something and declined to call it
 *    anything (CLAUDE.md tier table);
 *  - cloaked links with no destination are counted as unknown, never as
 *    unmonetized (docs/LABELING.md §3).
 */
import type { PageReport } from './scan.js';

export interface PagePanel {
  headline: string;
  facts: { label: string; value: string }[];
  disclosure: string;
  notes: string[];
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Where the disclosure sits. A position, never a grade. */
export function describeDisclosure(report: PageReport): string {
  const d = report.disclosure;
  if (d === null) return 'No disclosure text was detected on this page.';
  const where = d.inFooter ? ' It is inside the page footer.' : '';
  if (d.beforeFirstBadgedLink === null) {
    return `Disclosure text was detected. No link on this page was marked, so there is no first marked link to place it against.${where}`;
  }
  const position = d.beforeFirstBadgedLink ? 'above' : 'below';
  return `Disclosure text was detected ${position} the first marked link.${where}`;
}

export function describePage(report: PageReport): PagePanel {
  const badged = report.badgedConfirmed + report.badgedLikely;
  const facts: { label: string; value: string }[] = [
    { label: 'Links marked', value: String(badged) },
    { label: '— confirmed', value: String(report.badgedConfirmed) },
    { label: '— likely', value: String(report.badgedLikely) },
    {
      label: 'Ranked picks detected',
      value:
        report.picks.length === 0
          ? 'none'
          : `${report.picks.length}, of which ${report.picksWithBadgedLink} carry a marked link`,
    },
    {
      label: 'Links examined',
      value: `${report.anchorsExamined} of ${report.anchorsInDocument} on the page`,
    },
  ];

  const notes: string[] = [];
  if (report.capped) {
    notes.push(
      'The scan stopped at its link cap, so this page was not read to the end. Counts below are a floor, not a total.',
    );
  }
  if (report.declaredNotBadged > 0) {
    // The card fact from CLAUDE.md's tier table, said on the page it applies
    // to: "N direct merchant links the publisher marked sponsored; mechanism
    // not detected". Never marked — `rel="sponsored"` is also the correct
    // attribute for paid placement that pays no commission, so marking it
    // would mark a publisher for complying with 16 CFR 255.
    notes.push(
      `${plural(report.declaredNotBadged, 'link', 'links')} the publisher marked sponsored point at another company's domain with no affiliate mechanism detected. Counted, never marked.`,
    );
  }
  const otherPossible = report.possibleNotBadged - report.declaredNotBadged;
  if (otherPossible > 0) {
    notes.push(
      `${plural(otherPossible, 'further link', 'further links')} carried a weaker signal (tier "possible") and was not marked either.`,
    );
  }
  notes.push(
    'Links whose only signal is a bare ?ref= are not searched for at all: that tier is never marked, so the count above is a floor rather than a total.',
  );
  if (report.cloakedUnresolved > 0) {
    notes.push(
      `${plural(report.cloakedUnresolved, 'link is', 'links are')} cloaked and we do not have the destination. Recorded as unknown, never as unmonetized.`,
    );
  }
  // A refusal is a FINDING, not a gap, and the reader gets the difference.
  // "We have never looked" and "the host's operator told us not to" are two
  // different sentences and the line above is the first one.
  if (report.cloakRefusedByOperator > 0) {
    notes.push(
      `${plural(report.cloakRefusedByOperator, 'cloaked link', 'cloaked links')} we did look at and could not resolve: the host's own robots.txt refuses us, or we were turned away. That is a finding about the host, not a gap in this page.`,
    );
  }
  if (report.resolvedNotBadged > 0) {
    notes.push(
      `${plural(report.resolvedNotBadged, 'cloaked link', 'cloaked links')} resolved to a destination that carries no affiliate signal we recognise. Not marked.`,
    );
  }
  if (report.resolutionsApplied > 0) {
    notes.push(
      `${plural(report.resolutionsApplied, 'cloaked link was', 'cloaked links were')} marked using a destination resolved on our servers, cookielessly. Your browser did not follow them.`,
    );
  }
  if (report.cloaksAnsweredFromBundle > 0) {
    notes.push(
      `${plural(report.cloaksAnsweredFromBundle, 'cloaked address was', 'cloaked addresses were')} answered from the table shipped inside this extension. No request left your browser to do it — not to us, and not to anyone.`,
    );
  }
  notes.push(
    'Position of the disclosure is an observation about this page. It is not the publisher’s disclosure grade, which is computed over a whole sample and shown on the card.',
  );

  return {
    headline:
      badged === 0
        ? 'No affiliate links marked on this page'
        : `${plural(badged, 'affiliate link', 'affiliate links')} marked on this page`,
    facts,
    disclosure: describeDisclosure(report),
    notes,
  };
}
