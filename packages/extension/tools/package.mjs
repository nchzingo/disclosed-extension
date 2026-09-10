/**
 * package.mjs — zip each built target for store upload, and print the hashes.
 *
 * The hash is printed because a store upload is the one moment the artifact
 * leaves this machine, and "the zip I uploaded" needs to be a checkable claim
 * rather than a memory. Recording it here means a later question — did the
 * listing ship the build that passed verify-built? — has an answer.
 */
import { mkdirSync, readFileSync, rmSync, existsSync } from 'node:fs';
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
  // DELETE FIRST. `zip -r` UPDATES an existing archive rather than replacing it:
  // entries whose names still exist are refreshed, and entries whose names have
  // gone — a content-hashed chunk from a previous build, say — are KEPT. That is
  // how this produced a store package containing two popup chunks, one of them
  // orphaned from a build eleven hours earlier, at 472 KB instead of 317 KB.
  //
  // Nothing referenced the stale chunk, so it was dead weight rather than shipped
  // code. It is still the wrong artifact to upload: a reviewer reading the
  // package sees a file nothing loads, and the failure mode one build later —
  // where the stale chunk IS the one the HTML names — is shipping old code from a
  // zip that looked fine.
  rmSync(zip, { force: true });
  execFileSync('zip', ['-qr', zip, '.'], { cwd: dir });
  const sha = createHash('sha256').update(readFileSync(zip)).digest('hex');
  console.log(`${zip.slice(root.length + 1).padEnd(46)} sha256 ${sha}`);
  made += 1;
}
console.log(`\n${made} package(s). Upload the chrome one to the Chrome Web Store.`);
console.log('Listing text and every privacy answer: packages/extension/store/CHROME-WEB-STORE.md');
