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
import { existsSync, readFileSync } from 'node:fs';
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

/**
 * EVERY FILE THE MANIFEST NAMES MUST BE IN THE PACKAGE.
 *
 * Added 2026-09-10, after declaring `icons` produced a build whose manifest
 * named four PNGs that were not in it. WXT resolves `publicDir` from the project
 * root rather than from `srcDir`, so with `srcDir: 'src'` it copied nothing —
 * and printed no warning, and exited 0. The extension would have loaded with a
 * broken icon and the store would have rejected the package at review.
 *
 * These read `.output/`, so they need a build. They SKIP loudly rather than pass
 * when there is none: a test that reports success for having found no artifact
 * is the shape of the bug it is here to catch.
 */
describe('the built package', () => {
  const OUT = join(REPO_ROOT, 'packages', 'extension', '.output', 'chrome-mv3');
  const built = existsSync(join(OUT, 'manifest.json'));
  if (!built) {
    console.warn(`no build at ${OUT} — run: pnpm --filter @disclosed/extension build`);
  }

  it.skipIf(!built)('contains every file its manifest references', () => {
    const m = JSON.parse(readFileSync(join(OUT, 'manifest.json'), 'utf8')) as Record<string, unknown>;
    const referenced = new Set<string>();
    const walk = (v: unknown, key = ''): void => {
      if (typeof v === 'string') {
        // Anything that looks like a packaged path, not a URL or a title.
        if (/\.(png|js|html|css|json)$/.test(v) && !/^https?:/.test(v)) referenced.add(v);
        return;
      }
      if (Array.isArray(v)) return void v.forEach((x) => walk(x, key));
      if (v && typeof v === 'object') {
        for (const [k, val] of Object.entries(v)) walk(val, k);
      }
    };
    walk(m);
    expect(referenced.size, 'the manifest references no files at all').toBeGreaterThan(0);
    const missing = [...referenced].filter((f) => !existsSync(join(OUT, f)));
    expect(missing, `manifest names files that are not in the package: ${missing.join(', ')}`).toEqual([]);
  });

  it.skipIf(!built)('ships the four icon sizes the store and the toolbar need', () => {
    const m = JSON.parse(readFileSync(join(OUT, 'manifest.json'), 'utf8')) as {
      icons?: Record<string, string>;
    };
    // 128 is what the Chrome Web Store requires. Without it a submission stops
    // at the form, which is how this gap was found.
    expect(Object.keys(m.icons ?? {}).sort()).toEqual(['128', '16', '32', '48']);
    for (const [size, file] of Object.entries(m.icons!)) {
      const bytes = readFileSync(join(OUT, file));
      expect(bytes.subarray(0, 8).toString('hex'), `${file} is not a PNG`).toBe('89504e470d0a1a0a');
      // Dimensions out of the PNG header, not out of the filename.
      expect(bytes.readUInt32BE(16), `${file} width`).toBe(Number(size));
      expect(bytes.readUInt32BE(20), `${file} height`).toBe(Number(size));
    }
  });

  it.skipIf(!built)('the store icon asset IS the manifest icon, byte for byte', () => {
    // One file doing two jobs. If these ever diverge, the listing shows an icon
    // the extension does not use.
    const store = join(REPO_ROOT, 'packages', 'extension', 'store', 'images', 'icon-128.png');
    if (!existsSync(store)) {
      console.warn('no store/images/icon-128.png — run: node tools/store-images.mjs');
      return;
    }
    expect(readFileSync(store).equals(readFileSync(join(OUT, 'icon-128.png')))).toBe(true);
  });
});
