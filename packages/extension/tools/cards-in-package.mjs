/**
 * cards-in-package.mjs — how many publisher cards are inside a built package?
 *
 * `node tools/cards-in-package.mjs <path-to.zip|path-to-dir>`
 *
 * WHY IT READS THE ZIP RATHER THAN THE BUNDLE. The bundle on disk is what we
 * intended to embed; the zip is what gets uploaded. Those came apart once
 * already — a store build whose Vite alias silently did not apply shipped the
 * full bundle while the file beside it said `cards: []` — so the question worth
 * answering is about the artifact, not about its input.
 *
 * HOW IT COUNTS. The bundle is inlined into the content script as a JSON string
 * literal passed to `JSON.parse`. A card is the only object in it shaped
 * `{"publisher":"…","status":"…"`, so that shape is the signature. The counter
 * is validated against a FULL build before it is trusted on a reduced one — a
 * counter that returns zero because it is looking in the wrong place is exactly
 * the failure it exists to detect, and it would look identical to success.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Every `.js` file under a directory, recursively. */
function jsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...jsFiles(full));
    else if (entry.endsWith('.js')) out.push(full);
  }
  return out;
}

/**
 * The number of publisher cards embedded in a built package.
 *
 * Returns `{ cards, publishers }` — the count and the names, because a count on
 * its own cannot tell "zero, correctly" from "zero, because I looked in the
 * wrong file".
 */
export function cardsInPackage(target) {
  let dir = target;
  if (target.endsWith('.zip')) {
    if (!existsSync(target)) throw new Error(`no such package: ${target}`);
    dir = mkdtempSync(join(tmpdir(), 'cards-in-pkg-'));
    execFileSync('unzip', ['-oq', target, '-d', dir]);
  }
  const source = jsFiles(dir)
    .map((f) => readFileSync(f, 'utf8'))
    .join('\n');
  if (source.length === 0) throw new Error(`${target} contains no JavaScript at all`);

  const re = /\{\\?"publisher\\?":\\?"([^"\\]+)\\?",\\?"status\\?":/g;
  const publishers = new Set();
  for (const m of source.matchAll(re)) publishers.add(m[1]);
  return { cards: publishers.size, publishers: [...publishers].sort() };
}

if (process.argv[1]?.endsWith('cards-in-package.mjs')) {
  const target = process.argv[2];
  if (!target) {
    console.error('usage: cards-in-package.mjs <path-to.zip|path-to-dir>');
    process.exit(2);
  }
  const { cards, publishers } = cardsInPackage(target);
  console.log(`publisher cards in the package: ${cards}`);
  if (cards > 0) console.log(`  ${publishers.join(', ')}`);
}
