/**
 * store-bundle.mjs — the bundle the Chrome Web Store package embeds.
 *
 * `node tools/store-bundle.mjs`
 *
 * Writes `data/bundle/rules-store.json` and `data/bundle/lookup-gate-store.json`
 * with the publisher cards and the resolution table removed, and the bundle's
 * sha256 recomputed so it still verifies against itself.
 *
 * WHY THE STORE PACKAGE CARRIES NEITHER. Uploading a listing is publication, and
 * the seven-day right-of-reply windows have not run. A package that embeds no
 * publisher measurement is not publication at all — so the submission can go in
 * today, be reviewed while the windows run, and the cards arrive in a store
 * UPDATE on day 8, packaged from the same bundle the website publishes that
 * morning.
 *
 * WHAT THE STORE BUILD LOSES, STATED RATHER THAN GLOSSED. Every site reports "no
 * report card", which is accurate — none has been published — and every cloaked
 * link is shown as cloaked with an unknown destination rather than answered from
 * the table. Both are states the extension already has and already explains.
 * Nothing about the zero-network claim weakens: with no table to answer from,
 * the artifact has every reason to ask and still asks nobody, which is the
 * stronger demonstration rather than the weaker one. `verify-built` asserts
 * exactly that when it is pointed at this bundle.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { gateBundle, gatedLookupGate } from './gated-bundle.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const BUNDLE_DIR = join(REPO, 'data', 'bundle');

export const STORE_BUNDLE = join(BUNDLE_DIR, 'rules-store.json');
export const STORE_GATE = join(BUNDLE_DIR, 'lookup-gate-store.json');

export function writeStoreBundle() {
  const raw = JSON.parse(readFileSync(join(BUNDLE_DIR, 'rules-latest.json'), 'utf8'));
  const gate = JSON.parse(readFileSync(join(BUNDLE_DIR, 'lookup-gate.json'), 'utf8'));

  const { bundle, withheld } = gateBundle(raw, ['cards', 'resolutions']);
  writeFileSync(STORE_BUNDLE, `${JSON.stringify(bundle)}\n`);
  writeFileSync(STORE_GATE, `${JSON.stringify(gatedLookupGate(gate, bundle), null, 2)}\n`);

  return { bundle, withheld };
}

if (process.argv[1]?.endsWith('store-bundle.mjs')) {
  const { bundle, withheld } = writeStoreBundle();
  console.log('store bundle written');
  console.log(`  cards withheld        ${withheld.cards}  -> ${bundle.cards.length} in the package`);
  console.log(`  resolutions withheld  ${withheld.resolutions}  -> ${bundle.resolutions.entries.length} in the package`);
  console.log(`  resolutions_truncated ${bundle.resolutions_truncated}  (an empty table is not a truncated one)`);
  console.log(`  sha256                ${bundle.sha256}  (recomputed over the reduced body)`);
  console.log(`  -> ${STORE_BUNDLE}`);
  console.log(`  -> ${STORE_GATE}`);
}
