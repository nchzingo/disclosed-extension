/**
 * cards.ts — what the popup says about the publisher whose page you are on.
 *
 * FIVE STATES, AND THEY ARE FIVE DIFFERENT SENTENCES. SPEC §2.2 is explicit
 * that a publisher below the publication threshold is shown as a STATE and
 * never as a number, and that the states are never merged:
 *
 *   ok                              a distribution is published: median ρ, CI, n
 *   insufficient_data               ρ is computable in principle; our sample is too small
 *   rho_not_computable              every priceable pick carries the same rate; ρ is undefined
 *   withheld_unresolved_monetization no affiliate mechanism was established on any pick
 *   not_scored_no_revenue           M̄ = 0 — the §3 gate, "takes no affiliate revenue"
 *
 * and a sixth situation this file names rather than hides: the bundle carries
 * NO CARD for this publisher. That is "no card", not a zero, not a dash and
 * not an empty panel — we have not measured this publisher, and saying so is
 * different from saying we measured nothing.
 *
 * Printing "insufficient data" over `rho_not_computable` blames our sample for
 * a fact about the publisher; printing it the other way claims a structural
 * finding where we merely have too little. SPEC §2.2 says so in those words
 * and this file is where that sentence becomes code.
 *
 * NO MEDIAN IS EVER RECONSTRUCTED. The bundle nulls `medianRho` below the
 * threshold (packages/crawler/src/build-rules-bundle.ts) and lib/bundle.ts
 * refuses a bundle that does otherwise. Nothing here recomputes, estimates or
 * infers one — `payoutRank` is non-null only when the card itself is
 * publishable and carries all three of median, CI and n.
 *
 * The state copy is mirrored from `packages/web/src/lib/cards.ts`
 * (`STATUS_COPY`) so the extension and the website say the SAME thing about
 * the same state. It is copied rather than imported because that package is a
 * Next.js app that reads the card files off disk at build time.
 */
import { registrableDomain } from '@disclosed/core';
import type { BundleCard } from './bundle.js';

export type PanelState =
  | 'ok'
  | 'insufficient_data'
  | 'rho_not_computable'
  | 'withheld_unresolved_monetization'
  | 'not_scored_no_revenue'
  | 'no_card';

export const STATUS_COPY: Record<PanelState, { label: string; short: string; detail: string }> = {
  ok: {
    label: 'Scored',
    short: 'Above the publication threshold.',
    detail:
      'This publisher has at least the minimum number of qualifying articles set by SPEC §2.2, so the Payout–Rank correlation is published with its interval, its sample size and its rate coverage.',
  },
  insufficient_data: {
    label: 'Not scored — below the article threshold',
    short: 'Fewer qualifying articles than SPEC §2.2 requires.',
    detail:
      'A qualifying article is one with enough priced picks, enough rated picks, and enough rate coverage for a per-article correlation to exist. This publisher has some, but fewer than the threshold. Nothing about the correlation is shown, because the threshold is what decides whether it may be shown at all.',
  },
  rho_not_computable: {
    label: 'Not scored — no payout variation to correlate',
    short: 'Every priceable pick carries the same rate.',
    detail:
      'This is not a data gap and must not be read as one. In every article, every pick we can price carries the SAME commission rate, and a rank correlation against a constant is undefined. More articles of the same shape would not change that. It is a fact about which merchants this publisher links to, not about how much we have collected.',
  },
  withheld_unresolved_monetization: {
    label: 'Not scored — monetization not established',
    short: 'No affiliate mechanism was established on this publisher’s picks.',
    detail:
      'No pick on this publisher carries a link we can establish is affiliate. That is a statement about what this method observed, not a statement that the publisher earns nothing: display advertising, sponsored placement paid outside an affiliate network, subscriptions and licensing are all outside what this method can see.',
  },
  not_scored_no_revenue: {
    label: 'Takes no affiliate revenue',
    short: 'Monetization exposure is zero across the sample.',
    detail:
      'With no commission on any pick there is no conflict of interest for a Payout–Rank correlation to measure, so this publisher is not scored at all. The sample size is stated beside the claim, and the same limit applies: this method sees affiliate links and nothing else.',
  },
  no_card: {
    label: 'No report card',
    short: 'This publisher is not in the bundle.',
    detail:
      'The rules bundle shipped with this extension carries no card for this site. We have not measured it. That is different from having measured it and found nothing, and it is shown differently.',
  },
};

/** How the page's host was matched to a card. Shown, so nothing is implied. */
export type CardMatch = 'exact' | 'www_stripped' | 'registrable_domain' | 'none';

export interface PublisherPanel {
  /** The host of the page. */
  host: string;
  /** The publisher the CARD names, which may be the registrable domain. */
  cardPublisher: string | null;
  match: CardMatch;
  state: PanelState;
  label: string;
  short: string;
  detail: string;
  /**
   * NON-NULL ONLY when the card is publishable. SPEC §2.2: below the
   * threshold a card is a state, and a state is not a number.
   */
  payoutRank: { median: number; ci95: [number, number]; n: number } | null;
  /** Everything else the card carries, as label/value pairs. */
  facts: { label: string; value: string }[];
}

function pct(v: number | null, digits = 1): string {
  return v === null ? 'not measured' : `${(v * 100).toFixed(digits)}%`;
}

function signed(v: number, digits = 3): string {
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(digits)}`;
}

function stateOf(card: BundleCard): PanelState {
  switch (card.status) {
    case 'ok':
    case 'insufficient_data':
    case 'rho_not_computable':
    case 'withheld_unresolved_monetization':
    case 'not_scored_no_revenue':
      return card.status;
    default:
      // A status this build does not know is not silently rendered as one it
      // does. It is shown as "no card" — we cannot describe what it asserts.
      return 'no_card';
  }
}

/** The card for a page host, and how it was matched. */
export function findCard(
  host: string,
  cards: ReadonlyMap<string, BundleCard>,
): { card: BundleCard | null; match: CardMatch } {
  const h = host.toLowerCase();
  const exact = cards.get(h);
  if (exact !== undefined) return { card: exact, match: 'exact' };
  if (h.startsWith('www.')) {
    const stripped = cards.get(h.slice(4));
    if (stripped !== undefined) return { card: stripped, match: 'www_stripped' };
  }
  const registrable = registrableDomain(h);
  if (registrable !== null && registrable !== h) {
    const byDomain = cards.get(registrable);
    if (byDomain !== undefined) return { card: byDomain, match: 'registrable_domain' };
  }
  return { card: null, match: 'none' };
}

/** The publisher panel for a page host. Never invents a number. */
export function describePublisher(
  host: string,
  cards: ReadonlyMap<string, BundleCard>,
): PublisherPanel {
  const { card, match } = findCard(host, cards);
  if (card === null) {
    const copy = STATUS_COPY.no_card;
    return {
      host,
      cardPublisher: null,
      match,
      state: 'no_card',
      ...copy,
      payoutRank: null,
      facts: [],
    };
  }

  const state = stateOf(card);
  const copy = STATUS_COPY[state];
  const publishable =
    state === 'ok' &&
    card.publishable &&
    card.medianRho !== null &&
    card.ci95 !== null &&
    card.n !== null;

  const facts: { label: string; value: string }[] = [
    { label: 'Monetized (M̄)', value: pct(card.mBar) },
  ];
  if (card.mBarBadgedOnly !== null && card.mBarBadgedOnly !== card.mBar) {
    // SPEC §0.1.0: the runtime-attribution basis is published separately so a
    // reader can subtract it. Shown only when it actually moved M̄.
    facts.push({ label: 'M̄, badged picks only', value: pct(card.mBarBadgedOnly) });
  }
  facts.push({ label: 'Articles in the sample', value: String(card.articles) });
  facts.push({ label: 'Rate coverage', value: pct(card.rateCoverage) });
  const grades = Object.entries(card.disclosure.distribution)
    .filter(([, n]) => n > 0)
    .map(([g, n]) => `${g}×${n}`)
    .join(' ');
  facts.push({ label: 'Disclosure grades', value: grades === '' ? 'not measured' : grades });
  facts.push({ label: 'Gaming flag (ρ>0.99, n≤5)', value: String(card.gamingFlagCount) });
  facts.push({ label: 'Card generated', value: card.generatedAt.slice(0, 10) });
  facts.push({ label: 'Spec', value: card.specVersion });
  if (!publishable && card.n !== null) {
    // The qualifying-article count is a fact about our sample and is shown in
    // every below-threshold state. It is not a score and is never near one.
    facts.push({ label: 'Qualifying articles (n)', value: String(card.n) });
  }

  return {
    host,
    cardPublisher: card.publisher,
    match,
    state,
    label: copy.label,
    short: copy.short,
    detail: copy.detail,
    payoutRank:
      publishable && card.medianRho !== null && card.ci95 !== null && card.n !== null
        ? { median: card.medianRho, ci95: card.ci95, n: card.n }
        : null,
    facts,
  };
}

/** "median ρ −0.547, 95% CI [−0.712, −0.244], n = 26". Never without all three. */
export function formatPayoutRank(pr: { median: number; ci95: [number, number]; n: number }): string {
  return `median ρ ${signed(pr.median)}, 95% CI [${signed(pr.ci95[0])}, ${signed(pr.ci95[1])}], n = ${pr.n}`;
}
