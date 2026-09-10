/**
 * build-corpus-fixture.mjs — the corpus sample test/trie-parity.test.ts runs
 * against. Run with `pnpm --filter @disclosed/extension build-corpus-fixture`.
 *
 * WHY A FIXTURE AND NOT THE CORPUS. `data/corpus/links.jsonl` is 20,635 links
 * and it is the moat; it does not belong inside a package that ships to a
 * browser. This writes a few hundred of them, chosen deterministically, so a
 * third party can regenerate the identical file from the same corpus and check
 * that we did not pick the links that made the test pass.
 *
 * THE SAMPLE IS STRATIFIED BY `classify()` TIER, and that needs saying plainly:
 * a uniform sample of 20,635 corpus links would be almost entirely `none`, and
 * the property under test — that the prefilter never rejects a link the
 * classifier would badge — would then be tested against a handful of badged
 * links. Stratifying spends the quota where the failure would be.
 *
 * THE TIER IS USED FOR SAMPLING ONLY AND IS NOT WRITTEN TO THE FIXTURE. The
 * test recomputes `classify()` itself; if the fixture carried the tiers, the
 * test would be comparing today's classifier to a snapshot of yesterday's,
 * which is a different assertion and a weaker one.
 *
 * Within each stratum links are ordered by SHA-256 of their own content —
 * a deterministic, content-keyed order that nobody chose.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classify, parseRuleset } from '@disclosed/core';
import { sha256Hex } from '@disclosed/core/canonical';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');
const OUT = join(here, '..', 'test', 'fixtures', 'corpus-sample.json');

/** Links kept per tier. `possible` and `none` are the cheap strata. */
const QUOTA = { confirmed: 150, likely: 150, possible: 100, none: 150 };

/**
 * CLOAK QUOTA — added 2026-09-08 with the ship-the-table ruling.
 *
 * A cloaked, unbadged link is the ONLY shape that ever made this extension
 * reach for the network, so it is the shape the zero-network claim has to be
 * tested on. Two strata, because the two answers are different code paths:
 * `inTable` are cloaks the shipped resolution table can answer, `notInTable`
 * are cloaks it cannot and which therefore stay unresolved. A test that used
 * only the first would prove nothing about the second, which is the case that
 * used to fire a request.
 */
const CLOAK_QUOTA = { inTable: 150, notInTable: 150 };

const bundle = JSON.parse(
  readFileSync(join(repoRoot, 'data', 'bundle', 'rules-latest.json'), 'utf8'),
);
const ruleset = parseRuleset(bundle.networks);

const RESOLUTION_HASHES = new Set(
  (bundle.resolutions?.entries ?? []).map((e) => e.hash),
);
const CLOAK_PATHS = bundle.networks?.cloak_path_hints?.patterns ?? [];
// `requires_resolution` is a LIST OF HOSTS on the entry (amazon_associates
// carries `["amzn.to"]`), not a boolean on the entry. Reading it as a boolean
// silently produced an empty set and a cloak stratum missing every amzn.to
// link in the corpus — caught on 2026-09-08 by the stratum printing 12 of 12.
const REQUIRES_RESOLUTION_HOSTS = new Set(
  (bundle.networks?.networks ?? [])
    .flatMap((n) => (Array.isArray(n.requires_resolution) ? n.requires_resolution : []))
    .map((h) => String(h).replace(/^\*\./, '').toLowerCase()),
);

/** The shape lib/scan.ts pends: cloak path, or a host that needs resolving. */
function isCloak(href) {
  try {
    const u = new URL(href);
    const host = u.hostname.toLowerCase();
    for (const h of REQUIRES_RESOLUTION_HOSTS) {
      if (host === h || host.endsWith(`.${h}`)) return true;
    }
    const path = u.pathname.toLowerCase();
    return CLOAK_PATHS.some((p) => path.includes(p));
  } catch {
    return false;
  }
}

const seen = new Set();
const byTier = { confirmed: [], likely: [], possible: [], none: [] };
const byCloak = { inTable: [], notInTable: [] };

for (const line of readFileSync(join(repoRoot, 'data', 'corpus', 'links.jsonl'), 'utf8').split('\n')) {
  if (line.trim() === '') continue;
  const row = JSON.parse(line);
  const href = row.href;
  if (typeof href !== 'string' || !/^https?:\/\//i.test(href)) continue;
  const rel = typeof row.rel === 'string' ? row.rel : null;
  const sourceUrl = typeof row.articleUrl === 'string' ? row.articleUrl : null;
  const key = `${sourceUrl}\n${rel}\n${href}`;
  if (seen.has(key)) continue;
  seen.add(key);
  const tier = classify(href, ruleset, { rel, sourceUrl }).tier;
  byTier[tier].push({ order: sha256Hex(key), href, rel, sourceUrl });
  // Cloaks are collected by URL, not by (source, rel, href): what the table
  // answers is a URL, and one URL asked twice is one lookup.
  if ((tier === 'possible' || tier === 'none') && isCloak(href)) {
    const stratum = RESOLUTION_HASHES.has(sha256Hex(href)) ? 'inTable' : 'notInTable';
    byCloak[stratum].push({ order: sha256Hex(href), href, rel, sourceUrl });
  }
}

const links = [];
const strata = {};
for (const [tier, quota] of Object.entries(QUOTA)) {
  const pool = byTier[tier].sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0));
  const taken = pool.slice(0, quota);
  strata[tier] = { inCorpus: pool.length, sampled: taken.length };
  for (const { href, rel, sourceUrl } of taken) links.push({ href, rel, sourceUrl });
}

const cloaks = [];
const cloakStrata = {};
for (const [stratum, quota] of Object.entries(CLOAK_QUOTA)) {
  const byUrl = new Map();
  for (const row of byCloak[stratum]) if (!byUrl.has(row.href)) byUrl.set(row.href, row);
  const pool = [...byUrl.values()].sort((a, b) =>
    a.order < b.order ? -1 : a.order > b.order ? 1 : 0,
  );
  const taken = pool.slice(0, quota);
  cloakStrata[stratum] = { inCorpus: pool.length, sampled: taken.length };
  for (const { href, rel, sourceUrl } of taken) cloaks.push({ href, rel, sourceUrl });
}

const fixture = {
  note:
    'Deterministic sample of data/corpus/links.jsonl, stratified by classify() tier at generation time. ' +
    'Tiers are NOT recorded here: the test recomputes them. Regenerate with tools/build-corpus-fixture.mjs.',
  source: 'data/corpus/links.jsonl',
  bundleSha256: bundle.sha256,
  quota: QUOTA,
  /** Stratum sizes AS OF GENERATION. Documentation; no test reads them. */
  strata,
  links,
  cloakQuota: CLOAK_QUOTA,
  cloakStrata,
  /**
   * Cloaked, unbadged corpus URLs — the only shape that ever reached for the
   * network. Membership of the resolution table is NOT recorded per row: the
   * test recomputes it, for the same reason tiers are not recorded.
   */
  cloaks,
};
writeFileSync(OUT, `${JSON.stringify(fixture, null, 2)}\n`);
console.log(
  `wrote ${links.length} links and ${cloaks.length} cloaks to ${OUT}\n` +
    Object.entries(strata)
      .map(([t, s]) => `  ${t.padEnd(12)} ${s.sampled} of ${s.inCorpus}`)
      .join('\n') +
    '\n' +
    Object.entries(cloakStrata)
      .map(([t, s]) => `  cloak:${t.padEnd(6)} ${s.sampled} of ${s.inCorpus}`)
      .join('\n'),
);
