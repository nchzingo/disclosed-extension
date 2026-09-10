/**
 * The manifest, and the sentence a store reviewer reads.
 *
 * Two things are pinned here. The Chrome Web Store single-purpose statement is
 * ONE sentence and must be identical in the manifest and the README — a
 * single-purpose statement that says two different things in two places is a
 * single-purpose statement nobody can check. And the manifest must keep asking
 * for nothing: no `permissions`, no `host_permissions`, no `storage`. A
 * permission added by accident is a capability this extension's privacy claim
 * says it does not have.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { API_ORIGIN, FIREFOX_ADDON_ID } from '@disclosed/core';
import config, { resolutionTableTruncated } from '../wxt.config.js';
import { REPO_ROOT } from './helpers.js';

const SINGLE_PURPOSE = 'disclose affiliate relationships on the page you are viewing';

type ManifestFn = (env: {
  browser: string;
  manifestVersion: number;
  command: string;
  mode: string;
}) => Record<string, unknown>;

function manifestFor(browser: string): Record<string, unknown> {
  const fn = config.manifest as unknown as ManifestFn;
  return fn({ browser, manifestVersion: 3, command: 'build', mode: 'production' });
}

describe('the manifest', () => {
  it('states the single purpose verbatim, and the README says the same words', () => {
    expect(manifestFor('chrome').description).toBe(SINGLE_PURPOSE);
    const readme = readFileSync(
      join(REPO_ROOT, 'packages', 'extension', 'README.md'),
      'utf8',
    );
    expect(readme).toContain(SINGLE_PURPOSE);
  });

  it('asks for no permissions and no host permissions on any target', () => {
    for (const browser of ['chrome', 'edge', 'firefox']) {
      const manifest = manifestFor(browser);
      expect(manifest.permissions).toBeUndefined();
      expect(manifest.host_permissions).toBeUndefined();
      expect(manifest.optional_permissions).toBeUndefined();
    }
  });

  it('declares Firefox’s data-collection consent as none', () => {
    const gecko = (
      manifestFor('firefox').browser_specific_settings as {
        gecko: { id: string; data_collection_permissions: { required: string[] } };
      }
    ).gecko;
    expect(gecko.id).toBe(FIREFOX_ADDON_ID);
    expect(gecko.data_collection_permissions.required).toEqual(['none']);
  });

  /**
   * THE GATE, AND IT IS THE BROWSER'S, NOT OURS (ruling 2026-09-08).
   *
   * Setting an API base used to be sufficient to earn a host permission. It no
   * longer is: the shipped bundle carries the whole resolution table, so
   * `resolutions_truncated` is false and no host permission is emitted on any
   * target no matter what WXT_API_BASE says. This is the assertion behind the
   * sentence "the extension makes zero network calls, full stop" — a branch in
   * the content script could be refactored away, and this cannot, because the
   * browser is the one enforcing it.
   */
  it('emits NO host permission even with an API base, while the whole table ships', () => {
    expect(resolutionTableTruncated()).toBe(false);
    const before = process.env.WXT_API_BASE;
    try {
      process.env.WXT_API_BASE = API_ORIGIN;
      for (const browser of ['chrome', 'edge', 'firefox']) {
        expect(manifestFor(browser).host_permissions).toBeUndefined();
      }
    } finally {
      if (before === undefined) delete process.env.WXT_API_BASE;
      else process.env.WXT_API_BASE = before;
    }
  });

  it('still fails the build on a malformed API base, gate or no gate', () => {
    const before = process.env.WXT_API_BASE;
    try {
      process.env.WXT_API_BASE = 'not a url';
      expect(() => manifestFor('chrome')).toThrowError(/WXT_API_BASE/);
    } finally {
      if (before === undefined) delete process.env.WXT_API_BASE;
      else process.env.WXT_API_BASE = before;
    }
  });

  it('the gate file agrees with the bundle it was derived from', () => {
    const gate = JSON.parse(
      readFileSync(join(REPO_ROOT, 'data', 'bundle', 'lookup-gate.json'), 'utf8'),
    ) as { resolutions_truncated: boolean; bundleSha256: string; resolutionsShipped: number };
    const bundle = JSON.parse(
      readFileSync(join(REPO_ROOT, 'data', 'bundle', 'rules-latest.json'), 'utf8'),
    ) as { sha256: string; resolutions_truncated: boolean; resolutions: { shipped: number } };
    expect(gate.bundleSha256).toBe(bundle.sha256);
    expect(gate.resolutions_truncated).toBe(bundle.resolutions_truncated);
    expect(gate.resolutionsShipped).toBe(bundle.resolutions.shipped);
    expect(resolutionTableTruncated()).toBe(bundle.resolutions_truncated);
  });
});
