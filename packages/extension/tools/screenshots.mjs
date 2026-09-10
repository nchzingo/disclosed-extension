/**
 * screenshots.mjs — store listing screenshots, taken from the REAL built
 * extension running in a real browser.
 *
 * `node tools/screenshots.mjs` (after `pnpm --filter @disclosed/extension build`)
 *
 * WHY IT LOADS THE ARTIFACT RATHER THAN MOCKING IT. A store screenshot is a
 * claim about what the software does. Rendering a mock-up of the popup would
 * make the listing a drawing of the product rather than a picture of it, and
 * this is a listing whose central claim is that you can check it yourself. So
 * Chromium is launched with the built `.output/<target>` loaded as an unpacked
 * extension, the demo article is served over http (the content script only
 * matches http/https, which is itself a fact worth not working around), and
 * every dot in the resulting image was placed by the shipped bytes.
 *
 * ONE PIECE OF SCAFFOLDING, NAMED HERE BECAUSE IT IS IN THE PICTURE. A browser
 * action popup cannot be opened by automation, so the popup is loaded as an
 * ordinary tab — at which point `tabs.query({active: true})` returns the popup
 * itself and the popup correctly reports that there is nothing to read. The
 * only override is that that one query returns the demo tab instead. Everything
 * after it is real: a real message to the real content script on a real page,
 * the real bundle, the real rendering path.
 *
 * The demo article is SYNTHETIC and says so on its face. Screenshotting a real
 * publisher's page would put someone else's masthead in our store listing
 * beside a measurement about them, which is the one thing the right-of-reply
 * rule exists to prevent.
 */
import { createServer } from 'node:http';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '../../crawler/node_modules/playwright/index.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const TARGET = process.argv[2] ?? 'chrome-mv3';
const EXT = join(root, '.output', TARGET);
const OUT = join(root, '.output', 'store-assets');

/** Chrome Web Store accepts 1280x800 or 640x400. The larger is used. */
const WIDTH = 1280;
const HEIGHT = 800;

/**
 * A synthetic review article. The links are real shapes — an Amazon associates
 * tag, a network redirector, a publisher's own sponsored cloak, and a plain
 * link that pays nobody — so the marking in the screenshot is the marking the
 * classifier really does, on the tiers it really assigns.
 */
const ARTICLE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>The 4 Best Robot Vacuums — Demo Review</title>
<style>
  :root { color-scheme: light; }
  body { margin:0; background:#faf9f6; color:#1a1a18;
         font:17px/1.7 'Iowan Old Style',Charter,Georgia,serif; }
  .wrap { max-width: 44rem; margin: 0 auto; padding: 2.5rem 1.5rem 4rem; }
  .banner { background:#e8e4d9; border:1px solid #d8d5cc; border-radius:6px;
            padding:.6rem .9rem; font:13px/1.5 ui-sans-serif,system-ui,sans-serif;
            color:#55534d; margin-bottom:2rem; }
  h1 { font-size:2rem; line-height:1.2; letter-spacing:-0.02em; margin:0 0 .4rem; }
  .kicker { font:12px/1 ui-sans-serif,system-ui,sans-serif; letter-spacing:.09em;
            text-transform:uppercase; color:#86837a; margin:0 0 1rem; }
  .disclosure { font:13px/1.6 ui-sans-serif,system-ui,sans-serif; color:#55534d;
                border-left:3px solid #d8d5cc; padding-left:.85rem; margin:0 0 2.2rem; }
  h2 { font-size:1.15rem; margin:2.2rem 0 .3rem; }
  p { margin:.4rem 0 .8rem; }
  a { color:#2f4858; }
  .buy { font:14px/1 ui-sans-serif,system-ui,sans-serif; }
</style></head><body><div class="wrap">
  <div class="banner">Demonstration page. Not a real publication; the products and the links are examples.</div>
  <p class="kicker">Demo Review · Home</p>
  <h1>The 4 Best Robot Vacuums</h1>
  <p class="disclosure">We may earn a commission when you buy through links on our site.</p>

  <h2>1. Roborock S8 MaxV Ultra</h2>
  <p>The best all-round cleaner we tested, with the most reliable mop lift.</p>
  <p class="buy"><a href="https://www.amazon.com/dp/B0CN1B3K7T?tag=demo-20">Check price at Amazon</a></p>

  <h2>2. Dreame X40 Ultra</h2>
  <p>Nearly as good on carpet, and quieter at the dock.</p>
  <p class="buy"><a href="https://www.anrdoezrs.net/click-100-15">Check price at Dreame</a></p>

  <h2>3. Eufy Omni S1 Pro</h2>
  <p>The one to buy if the dock has to live in a living room.</p>
  <p class="buy"><a href="https://example.com/go/eufy-s1" rel="sponsored">Check price at Eufy</a></p>

  <h2>4. Shark PowerDetect</h2>
  <p>Cheapest of the four, and the only one with no self-emptying dock.</p>
  <p class="buy"><a href="https://www.sharkclean.com/products/powerdetect">Check price at Shark</a></p>

  <h2>How we tested</h2>
  <p>Read more on our <a href="https://example.com/methodology">methodology page</a>.</p>
</div></body></html>`;

async function main() {
  mkdirSync(OUT, { recursive: true });

  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(ARTICLE);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  // A NAMED demo host rather than a bare loopback address, resolved to the
  // local server by Chromium. It is a domain that cannot exist (`.invalid` is
  // reserved for exactly this), so the popup's publisher panel reads as a real
  // hostname and correctly reports that we hold no card for it.
  //
  // It is deliberately NOT a publisher we hold a card for. Serving our own
  // synthetic article under someone else's hostname would put their card in
  // our store listing beside an article they did not write.
  const port = server.address().port;
  const HOST = 'demo-review.invalid';
  const url = `http://${HOST}/best-robot-vacuums/`;

  const ctx = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    args: [
      `--disable-extensions-except=${EXT}`,
      `--load-extension=${EXT}`,
      `--host-resolver-rules=MAP ${HOST} 127.0.0.1:${port}`,
    ],
    viewport: { width: WIDTH, height: HEIGHT },
  });

  try {
    // ---------------------------------------------------------------- 1 ----
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: 'networkidle' });
    // The content script runs on requestIdleCallback. Wait for its own output
    // rather than for a duration: a sleep long enough to be safe is a sleep
    // that hides a regression in how long it takes.
    await page.waitForFunction(
      () => document.querySelectorAll('[data-disclosed-marker], .disclosed-dot, disclosed-marker').length > 0,
      { timeout: 15_000 },
    ).catch(() => {});
    await page.waitForTimeout(1200);
    await page.screenshot({ path: join(OUT, '1-marked-article.png') });
    console.log('1-marked-article.png');

    // ---------------------------------------------------------------- 2 ----
    // The extension id, taken from the service worker the browser actually
    // registered rather than computed from the key.
    let worker = ctx.serviceWorkers()[0];
    if (!worker) worker = await ctx.waitForEvent('serviceworker', { timeout: 15_000 }).catch(() => null);
    const extId = worker ? new URL(worker.url()).host : null;
    if (!extId) {
      console.error('no extension service worker — popup screenshot skipped');
    } else {
      // Leave exactly one other tab open — the article — so "the tab that is
      // not this popup" is unambiguous. The context opens a blank page of its
      // own on launch; it is closed here rather than filtered around.
      for (const p of ctx.pages()) if (p !== page) await p.close();

      const popup = await ctx.newPage();
      // THE ONE OVERRIDE, and it is only this: an automated browser cannot
      // open a browser-action popup, so the popup is a tab, and the tab it
      // would ask about is itself. Point that one query at the article.
      //
      // Identified by tab identity, NOT by URL. The extension holds no `tabs`
      // permission, so `tab.url` is undefined for every tab but the caller's —
      // which is the privacy property working exactly as intended, and it is
      // why the first version of this screenshot came back reading "Nothing to
      // read here".
      await popup.addInitScript(() => {
        const api = globalThis.browser ?? globalThis.chrome;
        if (!api?.tabs) return;
        const realQuery = api.tabs.query.bind(api.tabs);
        const getCurrent = api.tabs.getCurrent?.bind(api.tabs);
        api.tabs.query = async (info) => {
          if (!info?.active) return realQuery(info);
          const all = await realQuery({});
          const me = getCurrent ? await getCurrent() : undefined;
          const others = all.filter((t) => t.id !== me?.id);
          return others.length > 0 ? [others[0]] : realQuery(info);
        };
      });
      await popup.setViewportSize({ width: 420, height: 640 });
      await popup.goto(`chrome-extension://${extId}/popup.html`, { waitUntil: 'domcontentloaded' });
      await popup.waitForTimeout(1500);
      // fullPage, because the footer is where the popup states that this build
      // makes no network request at all — the listing's central claim, and the
      // first thing a 640px viewport cropped off.
      await popup.screenshot({ path: join(OUT, '2-popup-raw.png'), fullPage: true });

      // Composited onto a 1280x800 canvas, because the store wants that size
      // and a 420px image stretched to 1280 is a blurry picture of a crisp UI.
      const shot = readFileSync(join(OUT, '2-popup-raw.png')).toString('base64');
      const frame = await ctx.newPage();
      await frame.setViewportSize({ width: WIDTH, height: HEIGHT });
      await frame.setContent(
        `<body style="margin:0;height:100vh;display:grid;place-items:center;background:#f1efe9;
           font:14px ui-sans-serif,system-ui,sans-serif;color:#55534d">
           <div style="text-align:center">
             <img src="data:image/png;base64,${shot}"
                  style="max-height:${HEIGHT - 120}px;border:1px solid #d8d5cc;border-radius:8px;
                         box-shadow:0 8px 30px rgba(0,0,0,.10);background:#fff">
             <p style="margin:1rem 0 0">What the extension found on the page, and the published card for the site</p>
           </div></body>`,
      );
      await frame.waitForTimeout(400);
      await frame.screenshot({ path: join(OUT, '2-popup.png') });
      console.log('2-popup.png');
    }

    // ---------------------------------------------------------------- 3 ----
    // The shipped manifest, shown as itself. The listing's central claim is
    // that the extension asks for no permissions; the reviewer and the reader
    // can both read that in ten seconds, and this puts it in front of them.
    const manifest = readFileSync(join(EXT, 'manifest.json'), 'utf8');
    const pretty = JSON.stringify(JSON.parse(manifest), null, 2);
    const mp = await ctx.newPage();
    await mp.setViewportSize({ width: WIDTH, height: HEIGHT });
    await mp.setContent(
      `<body style="margin:0;height:100vh;display:grid;place-items:center;background:#f1efe9;
         font:14px/1.6 ui-sans-serif,system-ui,sans-serif;color:#1a1a18">
        <div style="max-width:56rem;padding:2rem">
          <p style="font:12px ui-sans-serif;letter-spacing:.09em;text-transform:uppercase;color:#86837a;margin:0 0 .4rem">The shipped manifest</p>
          <h1 style="font:600 26px ui-sans-serif;margin:0 0 .5rem">No permissions. No host permissions.</h1>
          <p style="margin:0 0 1rem;color:#55534d">The browser will not let this extension reach the network. That is not a policy — it is what the manifest asks for.</p>
          <pre style="background:#fff;border:1px solid #d8d5cc;border-radius:8px;padding:1.1rem 1.3rem;
                      font:13px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace;overflow:hidden;margin:0"><code>${pretty
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')}</code></pre>
        </div></body>`,
    );
    await mp.waitForTimeout(400);
    await mp.screenshot({ path: join(OUT, '3-manifest.png') });
    console.log('3-manifest.png');
  } finally {
    await ctx.close();
    server.close();
  }
  console.log(`\nstore assets -> ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
