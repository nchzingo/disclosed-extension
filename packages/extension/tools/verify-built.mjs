/**
 * verify-built.mjs — drive the SHIPPED artifact, not the source.
 *
 * `pnpm --filter @disclosed/extension build && node tools/verify-built.mjs`
 *
 * WHY THIS EXISTS ALONGSIDE THE TESTS. `vitest` runs `src/`. What reaches a
 * reader is `.output/<target>/content-scripts/content.js` — rolled up,
 * tree-shaken and minified — and the HARD RULE 1 guarantee is a property of
 * THOSE bytes. This loads the built content script into a jsdom page with a
 * stub `chrome` global, lets it run its idle pass, and checks the same four
 * things the tests check, on the artifact:
 *
 *   1. every anchor's `outerHTML` is identical before and after;
 *   2. markers were actually inserted (so the check is not vacuous);
 *   3. `fetch`, `XMLHttpRequest` and `sendBeacon` were called zero times —
 *      on a page that deliberately includes a cloak the extension cannot
 *      classify;
 *   4. no message was sent to the background worker; and
 *   5. **a cloak WAS answered from the resolution table shipped inside the
 *      artifact** (ruling 2026-09-08). Without this the zero above would be
 *      the old, weaker claim — "it asked nobody because it had nothing to
 *      ask". The page carries a real corpus cloak that the shipped table
 *      holds, and the report has to say it was answered locally.
 *
 * Exits non-zero on any failure. Not a vitest test because it requires a
 * build, and a test that silently skips when its input is missing is a test
 * that reports success for having done nothing.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const here = dirname(fileURLToPath(import.meta.url));
const target = process.argv[2] ?? 'chrome-mv3';
const scriptPath = join(here, '..', '.output', target, 'content-scripts', 'content.js');

let code;
try {
  code = readFileSync(scriptPath, 'utf8');
} catch {
  console.error(`no built content script at ${scriptPath}\nrun: pnpm --filter @disclosed/extension build`);
  process.exit(1);
}

/**
 * A review article: two badged shapes, an unbadged one, and TWO cloaks.
 *
 * `amzn.to/3abcdef` is invented and the table does not hold it — it stays
 * unresolved, which is the honest state and the case that used to fire a
 * request. `amzn.to/47RdXJv` is a real corpus URL the shipped table DOES hold,
 * so the artifact has to answer it from its own bytes.
 */
const IN_TABLE_CLOAK = 'https://amzn.to/47RdXJv';
const HTML = `<!doctype html><html><body>
  <p>We may earn a commission when you buy through links on our site.</p>
  <h2>1. Sony WH-1000XM5</h2>
  <a href="https://www.amazon.com/dp/B0123?tag=disclosed-20" data-x="1">Check price</a>
  <a href="https://example.com/go/sony" rel="sponsored">Buy direct</a>
  <h2>2. Bose QuietComfort Ultra</h2>
  <a href="https://goto.walmart.com/c/12/34/56">Walmart</a>
  <a href="https://www.bose.com/qc?ref=example">Bose</a>
  <a href="https://en.wikipedia.org/wiki/Headphones">Wikipedia</a>
  <a href="https://amzn.to/3abcdef">Short link</a>
  <a href="${IN_TABLE_CLOAK}">Toothbrush</a>
</body></html>`;

const dom = new JSDOM(HTML, {
  url: 'https://example.com/best-headphones',
  runScripts: 'outside-only',
});
const { window } = dom;

// A real browser has these; jsdom's `outside-only` sandbox does not expose
// them to evaluated code. `sha256Hex` (core) needs `TextEncoder` to hash a
// cloaked URL against the shipped resolution table, so withholding it would
// make this harness fail on a capability every target actually has.
window.TextEncoder = TextEncoder;
window.TextDecoder = TextDecoder;

const netCalls = [];
window.fetch = (...args) => {
  netCalls.push(['fetch', ...args]);
  return Promise.reject(new Error('blocked by verify-built.mjs'));
};
window.XMLHttpRequest = class {
  open(...args) {
    netCalls.push(['xhr', ...args]);
  }
  send() {}
  setRequestHeader() {}
};
window.navigator.sendBeacon = (...args) => {
  netCalls.push(['beacon', ...args]);
  return true;
};

const messages = [];
const pageListeners = [];
window.chrome = {
  runtime: {
    id: 'verify-built',
    // Captured rather than discarded: the popup's report is how this harness
    // reads what the artifact did, and asking for it is what the popup does.
    onMessage: { addListener: (fn) => pageListeners.push(fn) },
    sendMessage: (message) => {
      messages.push(message);
      return Promise.resolve(undefined);
    },
    getURL: (path) => `chrome-extension://verify-built/${path}`,
  },
};

const before = [...window.document.querySelectorAll('a')].map((a) => a.outerHTML);
window.eval(code);
await new Promise((resolve) => setTimeout(resolve, 300));
const after = [...window.document.querySelectorAll('a')].map((a) => a.outerHTML);
const markers = [...window.document.querySelectorAll('[data-disclosed-marker]')];

/** Ask the artifact what it found, exactly as the popup does. */
let report = null;
for (const fn of pageListeners) {
  fn({ type: 'disclosed:page-report' }, null, (payload) => {
    if (payload && payload.report) report = payload.report;
  });
}

const failures = [];
if (JSON.stringify(before) !== JSON.stringify(after)) {
  failures.push('AN ANCHOR CHANGED. HARD RULE 1.');
  console.error('before:', before);
  console.error('after: ', after);
}
if (markers.length === 0) failures.push('no marker was inserted — the check would be vacuous');
if (netCalls.length !== 0) failures.push(`${netCalls.length} network call(s): ${JSON.stringify(netCalls)}`);
if (messages.length !== 0) failures.push(`${messages.length} background message(s): ${JSON.stringify(messages)}`);
if (report === null) {
  failures.push('the artifact returned no page report — cannot check the resolution table');
} else if (report.cloaksAnsweredFromBundle < 1) {
  failures.push(
    'no cloak was answered from the shipped resolution table, so "zero network calls" is ' +
      'the vacuous version of the claim',
  );
} else if (report.cloakedUnresolved < 1) {
  failures.push('the unknown cloak was not left unresolved — the honest default is missing');
}

console.log(`target                    ${target}`);
console.log(`anchors byte-identical    ${JSON.stringify(before) === JSON.stringify(after)}`);
console.log(`markers inserted          ${markers.length} (${markers.map((m) => m.getAttribute('data-disclosed-marker')).join(', ')})`);
console.log(`network calls             ${netCalls.length}`);
console.log(`background messages       ${messages.length}`);
console.log(
  `cloaks answered locally   ${report === null ? 'n/a' : report.cloaksAnsweredFromBundle} ` +
    `(from the table inside the artifact, no request)`,
);
console.log(`cloaks left unresolved    ${report === null ? 'n/a' : report.cloakedUnresolved}`);

if (failures.length > 0) {
  console.error(`\nFAILED:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log('\nOK');
