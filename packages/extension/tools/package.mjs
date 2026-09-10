/**
 * package.mjs — zip each built target for store upload, and print the hashes.
 *
 * The hash is printed because a store upload is the one moment the artifact
 * leaves this machine, and "the zip I uploaded" needs to be a checkable claim
 * rather than a memory. Recording it here means a later question — did the
 * listing ship the build that passed verify-built? — has an answer.
 */
import { createWriteStream, mkdirSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const OUT = join(root, '.output', 'packages');
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;

mkdirSync(OUT, { recursive: true });
let made = 0;
for (const target of ['chrome-mv3', 'edge-mv3', 'firefox-mv3']) {
  const dir = join(root, '.output', target);
  if (!existsSync(dir)) {
    console.error(`no build at ${dir} — run: pnpm --filter @disclosed/extension build`);
    process.exit(1);
  }
  const zip = join(OUT, `disclosed-${version}-${target}.zip`);
  execFileSync('zip', ['-qr', zip, '.'], { cwd: dir });
  const sha = createHash('sha256').update(readFileSync(zip)).digest('hex');
  console.log(`${zip.slice(root.length + 1).padEnd(46)} sha256 ${sha}`);
  made += 1;
}
console.log(`\n${made} package(s). Upload the chrome one to the Chrome Web Store.`);
console.log('Listing text and every privacy answer: packages/extension/store/CHROME-WEB-STORE.md');
