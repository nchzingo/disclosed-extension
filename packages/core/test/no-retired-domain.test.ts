/**
 * No live string may name the domain we retired.
 *
 * `disclosed.app` was never registered to this project — it was an
 * aftermarket for-sale listing throughout — and on 2026-09-09 everything
 * moved to `disclosed.info`. The user agent alone had been hand-written in
 * eleven places, which is the arrangement that produces a half-finished
 * rename. This is the check that says the rename finished.
 *
 * It greps TRACKED files only, so ignored build output, `node_modules` and
 * the stale agent worktrees under `.claude/` are out of scope by
 * construction rather than by exclusion patterns that rot.
 *
 * THE ALLOWLIST IS THE INTERESTING PART, and `data/` is on it for a reason
 * that is not convenience. Those files record what we ACTUALLY SENT: a
 * `user_agent` field beside a `fetched_at` is a claim about a past request,
 * and rewriting it would make the record state that we sent a string we did
 * not send. That is the same act as editing a `fetched_at`, which HARD RULE 2
 * exists to forbid. The old value is the CORRECT value in those rows and it
 * stays there permanently.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { RETIRED_DOMAIN } from '../src/identity.js';

const REPO = join(process.cwd(), '..', '..');

/**
 * Paths permitted to name the retired domain, and why each one is.
 *
 * Every entry is either the crawl record (which must not be rewritten) or a
 * file whose job is to name the old domain. A path is allowed if it equals an
 * entry or sits under one.
 */
const ALLOWED: ReadonlyArray<readonly [string, string]> = [
  ['data/', 'the record of what was actually sent, and of what robots.txt was evaluated for'],
  ['docs/DOMAIN-CHANGE.md', 'the changelog of this very change'],
  ['packages/core/src/identity.ts', 'declares RETIRED_DOMAIN'],
  ['packages/core/test/no-retired-domain.test.ts', 'this file'],
];

function isAllowed(path: string): boolean {
  return ALLOWED.some(([prefix]) => path === prefix || path.startsWith(prefix));
}

/** Every tracked file, from git itself rather than a directory walk. */
const TRACKED = execFileSync('git', ['ls-files', '-z'], { cwd: REPO, maxBuffer: 64 * 1024 * 1024 })
  .toString('utf8')
  .split('\0')
  .filter(Boolean);

/**
 * Every spelling of the retired domain that is still the retired domain.
 *
 * The plain literal was not enough, and this list is a finding rather than a
 * precaution: `packages/extension/test/kanon.test.ts` pinned the old API
 * origin inside a regular expression, as `api\.disclosed\.app`, and both
 * the bulk replace AND the first version of this guard walked straight past
 * it. It was caught by a test failing for an unrelated reason. A domain hides
 * wherever a dot has to be escaped.
 */
const SPELLINGS = [RETIRED_DOMAIN, RETIRED_DOMAIN.replace(/\./g, '\\.')];

/** Read as bytes: one test file carries a literal NUL and is not valid UTF-8 text to `grep`. */
function mentions(path: string): boolean {
  try {
    const bytes = readFileSync(join(REPO, path));
    return SPELLINGS.some((s) => bytes.includes(s));
  } catch {
    return false;
  }
}

describe('the retired domain', () => {
  it('is named by no tracked file outside the allowlist', () => {
    const offenders = TRACKED.filter((p) => !isAllowed(p) && mentions(p));
    expect(offenders).toEqual([]);
  });

  // A check that stops finding anything because it stopped looking is worse
  // than no check. These pin the two halves of "we searched, and we searched
  // the right things".
  /**
   * THIS FILE NOW RUNS IN TWO REPOSITORIES, and the anchors had to learn that.
   *
   * `packages/core` and `packages/extension` are split into a public repository
   * (`ops/split-extension.mjs`), which carries this test and does NOT carry
   * `CLAUDE.md`, the crawler, or the rate table. The self-check used to name
   * those three, so the split's very first full run failed on the check that
   * exists to prove the scan is not vacuous — while the scan itself was
   * working perfectly.
   *
   * The requirement is kept and made repo-aware rather than loosened. The
   * universal anchors hold everywhere; the monorepo's extra anchors are
   * asserted only where the monorepo is, and `MONOREPO` is derived from the
   * tracked list rather than from an environment variable, so neither
   * repository can accidentally take the other's branch.
   */
  const MONOREPO = TRACKED.includes('packages/crawler/src/harvest.ts');

  it('actually searched a repository', () => {
    expect(TRACKED.length).toBeGreaterThan(50);
    // Present in both repositories, and both are load-bearing for this scan:
    // one declares the retired domain, the other is the single source of the
    // live one.
    expect(TRACKED).toContain('packages/core/src/identity.ts');
    expect(TRACKED).toContain('data/identity.json');
    if (MONOREPO) {
      expect(TRACKED.length).toBeGreaterThan(100);
      expect(TRACKED).toContain('CLAUDE.md');
      expect(TRACKED).toContain('scripts/vercel-build.sh');
      expect(TRACKED).toContain('packages/crawler/src/harvest.ts');
    }
  });

  it('can still see a hit — the allowlist entries are real, not stale paths', () => {
    let checked = 0;
    for (const [path] of ALLOWED) {
      if (path.endsWith('/')) continue;
      // In the split, an allowlisted monorepo path is simply not here. In the
      // monorepo every one of them must be tracked, so the strict form is kept
      // where it can be kept.
      if (!TRACKED.includes(path)) {
        expect(MONOREPO, `${path} is allowlisted but not tracked`).toBe(false);
        continue;
      }
      expect(mentions(path), `${path} is allowlisted but names nothing`).toBe(true);
      checked += 1;
    }
    // The scan can see a real hit, in a file that exists in whichever
    // repository this is: the crawl record in the monorepo, the identity file
    // in both.
    expect(checked).toBeGreaterThan(0);
    expect(mentions(MONOREPO ? 'data/rates/merchants.json' : 'data/identity.json')).toBe(true);
  });
});
