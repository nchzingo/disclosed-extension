/**
 * popup/main.ts — two panels: what is on this page, and what we have published
 * about this publisher. They are rendered apart and never blended.
 *
 * Everything the popup shows comes from two places: the content script's report
 * about the page the reader is already looking at, and the card summary in the
 * bundle that shipped with this extension. The popup makes no network request
 * and stores nothing.
 *
 * TEXT IS SET WITH `textContent`, NEVER `innerHTML`. Some of what is rendered —
 * a disclosure snippet, a host — is text the page controls, and a popup that
 * interpolated it into markup would be an injection sink inside the one
 * component a reader is entitled to trust.
 */
import { browser } from 'wxt/browser';
import { getBundle } from '../../lib/bundle.js';
import { describePublisher, formatPayoutRank, type PublisherPanel } from '../../lib/cards.js';
import { MSG_PAGE_REPORT, type PageReportResponse } from '../../lib/messages.js';
import { describePage } from '../../lib/panel.js';

function el(tag: string, text?: string, className?: string): HTMLElement {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className !== undefined) node.className = className;
  return node;
}

function definitionList(rows: readonly { label: string; value: string }[]): HTMLElement {
  const dl = el('dl');
  for (const row of rows) {
    dl.append(el('dt', row.label), el('dd', row.value));
  }
  return dl;
}

function section(...children: (Node | string)[]): HTMLElement {
  const s = el('section');
  for (const child of children) s.append(child);
  return s;
}

function publisherSection(panel: PublisherPanel): HTMLElement {
  const state = el('div', undefined, 'state');
  state.append(el('strong', panel.label), el('span', panel.short));
  const nodes: Node[] = [el('h2', `Publisher: ${panel.cardPublisher ?? panel.host}`), state];

  if (panel.payoutRank !== null) {
    // The only place a median ρ is ever printed, and only when the card is
    // publishable. Never a bare number: median, interval and n, together.
    nodes.push(el('p', formatPayoutRank(panel.payoutRank), 'rho'));
  }
  nodes.push(el('p', panel.detail, 'note'));
  if (panel.facts.length > 0) nodes.push(definitionList(panel.facts));
  if (panel.match === 'registrable_domain') {
    nodes.push(
      el(
        'p',
        `This card was published for ${panel.cardPublisher ?? ''}, matched to this page by registrable domain.`,
        'note',
      ),
    );
  }
  return section(...nodes);
}

function render(payload: PageReportResponse | null): void {
  const main = document.getElementById('main');
  if (main === null) return;
  main.textContent = '';

  if (payload === null) {
    main.append(
      section(
        el('h2', 'Nothing to read here'),
        el(
          'p',
          'This extension only reads ordinary web pages. It cannot see browser pages, extension pages, or a tab that has not finished loading.',
          'note',
        ),
      ),
    );
    return;
  }

  const page = describePage(payload.report);
  const pageNodes: Node[] = [el('h2', page.headline), definitionList(page.facts)];
  pageNodes.push(el('p', page.disclosure));
  if (payload.report.disclosure !== null) {
    pageNodes.push(el('p', `“${payload.report.disclosure.snippet}”`, 'note'));
  }
  for (const note of page.notes) pageNodes.push(el('p', note, 'note'));
  main.append(section(...pageNodes));

  const host = (() => {
    try {
      return new URL(payload.report.pageUrl).hostname;
    } catch {
      return payload.report.pageUrl;
    }
  })();
  try {
    main.append(publisherSection(describePublisher(host, getBundle().cards)));
  } catch (error) {
    console.error('[disclosed] rules bundle rejected', error);
  }

  const footer = el('footer');
  footer.append(
    el(
      'div',
      `Rules bundle v${payload.bundle.version}, built ${payload.bundle.generatedAt.slice(0, 10)} against ${payload.bundle.specVersion}.`,
    ),
    (() => {
      const code = el('code', `sha256 ${payload.bundle.sha256}`);
      return code;
    })(),
    el(
      'div',
      payload.lookupsDisabled
        ? 'This build makes no network requests at all: it has no API endpoint and no host permission.'
        : 'Cloaked links are looked up by a five-character hash prefix. The URL never leaves your browser.',
    ),
  );
  main.append(footer);
}

async function load(): Promise<void> {
  try {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    const tabId = tabs[0]?.id;
    if (tabId === undefined) {
      render(null);
      return;
    }
    const response = (await browser.tabs.sendMessage(tabId, { type: MSG_PAGE_REPORT })) as
      | PageReportResponse
      | null
      | undefined;
    render(response ?? null);
  } catch {
    // No content script in that tab (a browser page, a PDF, a tab that never
    // loaded). Not an error the reader needs to see as one.
    render(null);
  }
}

void load();
