/**
 * store-images.mjs — the extension icon and the two store promo tiles, RENDERED.
 *
 * `node tools/store-images.mjs [--out <dir>]`
 *
 * WHY THESE ARE GENERATED RATHER THAN DRAWN. Everything visible here is already
 * defined somewhere in this repository, and drawing it by hand would create a
 * second definition that drifts:
 *
 *   the mark        `src/lib/marker.ts` — the dot the extension puts beside a
 *                   link. 8px, round, #1a5fb4, FILLED for a verified signature
 *                   match and HOLLOW for a weaker one. That distinction is the
 *                   product's whole visual language, so the icon is that dot and
 *                   nothing else.
 *   the palette     `packages/web/src/app/globals.css` design tokens, copied
 *                   below with their token names beside them.
 *   the wordmark    `.masthead .wordmark` — uppercase sans, 700, 0.22em tracking.
 *   the sentence    the summary line in `store/CHROME-WEB-STORE.md`.
 *
 * THERE WAS NO ICON AT ALL BEFORE THIS. The manifest carried no `icons` key and
 * no `action.default_icon`, and nothing in the package was an image. The Chrome
 * Web Store requires a 128×128 icon, so this would have stopped a submission at
 * the form. `wxt.config.ts` now declares the sizes this writes into
 * `src/public/`, which is what makes "icon-128.png is manifest `icons.128`" a
 * fact rather than a resemblance — `test/manifest.test.ts` asserts the bytes are
 * identical.
 *
 * NO GRADIENT, NO IMAGERY, NO PUBLISHER NAME, NO NUMBER. A promo tile carrying a
 * figure would be a measurement published outside the page that explains it, and
 * a promo tile carrying a publisher's name would be one published without the
 * right of reply. Flat fills and type only.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '../../crawler/node_modules/playwright/index.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const OUT = arg('out', join(root, 'store', 'images'));
/** The manifest icon sizes also land here, and are what the build ships. */
const PUBLIC = join(root, 'src', 'public');

/** Design tokens, with the names they carry in the site's stylesheet. */
const T = {
  paper: '#faf9f6', // --paper
  paperSunk: '#f1efe9', // --paper-sunk
  ink: '#1a1a18', // --ink
  inkSoft: '#55534d', // --ink-soft
  inkFaint: '#86837a', // --ink-faint
  rule: '#d8d5cc', // --rule
  ruleStrong: '#9c988c', // --rule-strong
  mark: '#1a5fb4', // marker.ts — the dot
  sans: "ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  serif:
    "'Iowan Old Style', 'Charter', 'Palatino Linotype', Palatino, Georgia, 'Times New Roman', serif",
};

const SUMMARY = 'Marks the affiliate links on the page you’re reading.';
const CLAIMS = ['No network requests.', 'Never modifies a link.', 'Open source.'];

/**
 * The icon.
 *
 * The filled dot, with the hollow one behind it at half scale — the two tiers
 * the extension actually distinguishes, in the one image. Sized generously
 * because this is read at 16px in a toolbar more often than at 128.
 */
function icon(px) {
  const dot = Math.round(px * 0.44);
  const ring = Math.round(px * 0.24);
  const border = Math.max(1, Math.round(px * 0.035));
  return `<body style="margin:0">
    <div style="width:${px}px;height:${px}px;background:${T.paper};
                display:flex;align-items:center;justify-content:center;gap:${Math.round(px * 0.06)}px">
      <span style="width:${dot}px;height:${dot}px;border-radius:50%;
                   background:${T.mark};border:${border}px solid ${T.mark};box-sizing:border-box"></span>
      <span style="width:${ring}px;height:${ring}px;border-radius:50%;
                   background:transparent;border:${border}px solid ${T.mark};box-sizing:border-box"></span>
    </div></body>`;
}

/** Wordmark + one line, or + the three claims on the marquee. */
function promo(w, h, withClaims) {
  const scale = w / 440;
  const pad = Math.round(28 * scale);
  const dot = Math.round(13 * scale);
  const ring = Math.round(8 * scale);
  const border = Math.max(1, Math.round(1.6 * scale));
  const wordSize = Math.round(21 * scale);
  const lineSize = Math.round(15.5 * scale);
  const claimSize = Math.round(11 * scale * 0.72);
  return `<body style="margin:0">
    <div style="width:${w}px;height:${h}px;background:${T.paper};box-sizing:border-box;
                padding:${pad}px ${Math.round(pad * 1.25)}px;
                display:flex;flex-direction:column;justify-content:center;
                font-family:${T.sans};-webkit-font-smoothing:antialiased">
      <div style="display:flex;align-items:center;gap:${Math.round(9 * scale)}px;
                  margin-bottom:${Math.round(16 * scale)}px">
        <span style="width:${dot}px;height:${dot}px;border-radius:50%;background:${T.mark};
                     display:inline-block"></span>
        <span style="width:${ring}px;height:${ring}px;border-radius:50%;background:transparent;
                     border:${border}px solid ${T.mark};box-sizing:border-box;display:inline-block"></span>
        <span style="font-weight:700;font-size:${wordSize}px;letter-spacing:0.22em;
                     text-transform:uppercase;color:${T.ink};margin-left:${Math.round(4 * scale)}px">Disclosed</span>
      </div>
      <p style="margin:0;font-family:${T.serif};font-size:${lineSize}px;line-height:1.45;
                color:${T.inkSoft};max-width:${Math.round(w * 0.86)}px;
                text-wrap:balance">${SUMMARY}</p>
      ${
        withClaims
          ? `<div style="margin-top:${Math.round(22 * scale)}px;padding-top:${Math.round(18 * scale)}px;
                        border-top:1px solid ${T.rule};display:flex;gap:${Math.round(30 * scale)}px;
                        flex-wrap:nowrap;align-items:baseline;justify-content:space-between">
               ${CLAIMS.map(
                 (c) =>
                   `<span style="font-size:${claimSize}px;letter-spacing:0.06em;text-transform:uppercase;
                                 color:${T.inkFaint};white-space:nowrap;flex:0 0 auto">${c}</span>`,
               ).join('')}
             </div>`
          : ''
      }
    </div></body>`;
}

/**
 * Render one image, and REFUSE to write one whose content does not fit.
 *
 * A promo tile is fixed-size and its text is not: shortening a claim, changing a
 * font, or rendering on a machine that falls back to a different serif all move
 * the copy, and the failure mode is a word sliced off at the edge. That happened
 * twice while this file was being written — first the claims wrapped, then
 * "Open source." ran off the right — and both times the only thing that caught
 * it was looking at the picture.
 *
 * So the page measures itself. Anything wider or taller than the canvas throws,
 * naming what overflowed, and no file is written. Eyeballing does not scale to a
 * copy change made a year from now.
 */
async function shoot(ctx, html, w, h, path) {
  const page = await ctx.newPage();
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(html);
  await page.waitForTimeout(150);

  const overflow = await page.evaluate(
    ({ w, h }) => {
      const doc = document.documentElement;
      const bad = [];
      if (doc.scrollWidth > w) bad.push(`content is ${doc.scrollWidth}px wide in a ${w}px canvas`);
      if (doc.scrollHeight > h) bad.push(`content is ${doc.scrollHeight}px tall in a ${h}px canvas`);
      // And any individual element sticking out past the right edge, which a
      // flex container can do without the document itself scrolling.
      for (const el of document.querySelectorAll('span,p,div')) {
        const r = el.getBoundingClientRect();
        if (r.right > w + 0.5 || r.left < -0.5) {
          bad.push(`"${(el.textContent ?? '').trim().slice(0, 40)}" spans ${Math.round(r.left)}..${Math.round(r.right)}px`);
        }
      }
      return bad;
    },
    { w, h },
  );
  if (overflow.length > 0) {
    await page.close();
    throw new Error(`${path.split('/').pop()} does not fit:\n  ${overflow.join('\n  ')}`);
  }

  await page.screenshot({ path, clip: { x: 0, y: 0, width: w, height: h } });
  await page.close();
}

/** Width and height read out of the PNG header — not out of what we asked for. */
function pngSize(path) {
  const b = readFileSync(path);
  if (b.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error(`${path}: not a PNG`);
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20), bytes: b.length };
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  mkdirSync(PUBLIC, { recursive: true });
  const browser = await chromium.launch({ channel: 'chromium' });
  const ctx = await browser.newContext({ deviceScaleFactor: 1 });

  const made = [];
  try {
    // Manifest icons. Written into src/public so the build ships them, and the
    // 128 is ALSO the store's icon asset — one file, two jobs, no second copy.
    for (const px of [16, 32, 48, 128]) {
      const p = join(PUBLIC, `icon-${px}.png`);
      await shoot(ctx, icon(px), px, px, p);
      made.push(p);
    }
    const storeIcon = join(OUT, 'icon-128.png');
    writeFileSync(storeIcon, readFileSync(join(PUBLIC, 'icon-128.png')));
    made.push(storeIcon);

    const small = join(OUT, 'promo-small.png');
    await shoot(ctx, promo(440, 280, false), 440, 280, small);
    made.push(small);

    const marquee = join(OUT, 'promo-marquee.png');
    await shoot(ctx, promo(1400, 560, true), 1400, 560, marquee);
    made.push(marquee);
  } finally {
    await ctx.close();
    await browser.close();
  }

  // ASSERTED, NOT ASSUMED. The store rejects an image whose real dimensions are
  // not the ones it asked for, and "we set the viewport to 440x280" is not the
  // same claim as "this file is 440x280".
  const EXPECT = {
    'icon-16.png': [16, 16],
    'icon-32.png': [32, 32],
    'icon-48.png': [48, 48],
    'icon-128.png': [128, 128],
    'promo-small.png': [440, 280],
    'promo-marquee.png': [1400, 560],
  };
  const MAX_BYTES = 1024 * 1024;
  let bad = 0;
  for (const p of made) {
    const name = p.split('/').pop();
    const { width, height, bytes } = pngSize(p);
    const [ew, eh] = EXPECT[name];
    const dimOk = width === ew && height === eh;
    const sizeOk = bytes < MAX_BYTES;
    if (!dimOk || !sizeOk) bad += 1;
    console.log(
      `${(dimOk && sizeOk ? 'ok  ' : 'FAIL').padEnd(5)}${name.padEnd(20)}` +
        `${String(width).padStart(4)}x${String(height).padEnd(5)} ` +
        `${bytes.toLocaleString('en-US').padStart(9)} bytes` +
        `${dimOk ? '' : `  EXPECTED ${ew}x${eh}`}${sizeOk ? '' : '  OVER 1 MB'}`,
    );
  }
  console.log(`\nmanifest icons -> ${PUBLIC}`);
  console.log(`store assets   -> ${OUT}`);
  if (bad > 0) {
    console.error(`\n${bad} image(s) are the wrong size or too large.`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
