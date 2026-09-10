import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'wxt';

/**
 * THE IDENTITY IS READ FROM `data/identity.json`, NOT IMPORTED FROM CORE.
 *
 * It used to be `import { CONTACT_EMAIL, … } from '@disclosed/core'`, which is
 * the same three values from the same source — but core has to be COMPILED
 * before that import resolves, and this file is loaded by `wxt prepare`, which
 * runs as the extension's `postinstall`. So a clean `pnpm install` in a fresh
 * checkout failed before anything could build core:
 *
 *     ERROR  Cannot find module '…/@disclosed/core/dist/index.js'
 *         at wxt.config.ts:4:19
 *
 * The monorepo hid that for as long as a stale `dist/` happened to be lying
 * around; splitting the extension into its own repository is what surfaced it.
 * `data/identity.json` is the actual single source — core mirrors it under an
 * equality test — so reading it here removes a build-order dependency without
 * adding a second copy of anything, exactly as this file already does for
 * `lookup-gate.json` below.
 */
function identity(): { contact_email: string; firefox_addon_id: string; site_origin: string } {
  // TWO CANDIDATE PATHS, AND IT THROWS IF NEITHER EXISTS.
  //
  // Under `wxt build` this module is loaded from disk and `import.meta.url` is
  // a file: URL. Under vitest (`test/manifest.test.ts` imports this config to
  // assert what the manifest asks for) it is not, and `fileURLToPath` throws
  // `The URL must be of scheme file`. The cwd is `packages/extension` in that
  // case, so the same relative path resolves from there.
  //
  // Unlike `resolutionTableTruncated()` below, this does NOT fall back to a
  // default: a missing gate file withholds a capability, which is safe, while a
  // guessed contact address would put a wrong mailbox in a shipped manifest.
  const candidates: string[] = [];
  try {
    candidates.push(fileURLToPath(new URL('../../data/identity.json', import.meta.url)));
  } catch {
    /* not a file: URL — the cwd candidate below is the one that applies */
  }
  candidates.push(resolve(process.cwd(), '../../data/identity.json'));
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    return JSON.parse(readFileSync(path, 'utf8')) as {
      contact_email: string;
      firefox_addon_id: string;
      site_origin: string;
    };
  }
  throw new Error(`data/identity.json not found. Looked in: ${candidates.join(', ')}`);
}
const {
  contact_email: CONTACT_EMAIL,
  firefox_addon_id: FIREFOX_ADDON_ID,
  site_origin: SITE_ORIGIN,
} = identity();

/**
 * WXT build config — one codebase, three targets (chrome, edge, firefox),
 * Manifest V3 on all three.
 *
 * THE MANIFEST ASKS FOR NOTHING BY DEFAULT. No `permissions`, no
 * `host_permissions`, no `storage`, no `tabs`. The content script reads the
 * page it is already injected into and the popup talks to that content script;
 * neither needs a permission to do it. A default build is therefore incapable
 * of making a network request of any kind — not as a policy, as a fact about
 * what the browser will let it do (CLAUDE.md, Privacy architecture).
 *
 * The ONE exception is deliberate, opt-in at build time, AND currently
 * unreachable: the API origin is added to `host_permissions` only when
 * WXT_API_BASE is set **and** the shipped rules bundle says its resolution
 * table was TRUNCATED. Since the ruling of 2026-09-08 the whole table ships
 * inside the bundle (`data/bundle/lookup-gate.json` carries the flag), so
 * `resolutions_truncated` is false, no host permission is emitted on any
 * target, and the browser itself refuses the request that the code has already
 * declined to make.
 *
 * That ordering matters. The content script's own gate is a branch, and a
 * branch is one refactor away from being open; a missing `host_permissions`
 * entry is enforced by the browser against code that has already shipped.
 * Setting WXT_API_BASE today therefore does not produce a build that can make
 * a request — it produces the same build, and `test/manifest.test.ts` asserts
 * exactly that.
 *
 * `imports: false` disables WXT's auto-imported globals. Every symbol in this
 * package is imported by name, because a reader auditing a privacy claim
 * should not have to know which identifiers a framework injected.
 */

/** The origin of WXT_API_BASE, or null. Build-time only; never user input. */
function apiOrigin(): string | null {
  const raw = process.env.WXT_API_BASE;
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    throw new Error(`WXT_API_BASE is not a valid URL: ${raw}`);
  }
}

/**
 * Did the shipped bundle's resolution table have to be truncated?
 *
 * Read from `data/bundle/lookup-gate.json`, which `build-rules-bundle` writes
 * in the same statement that writes the bundle — a few hundred bytes, so this
 * config does not pull half a megabyte of resolution rows into the build to
 * read one boolean.
 *
 * **A missing or unreadable gate file answers FALSE**, which withholds the
 * host permission. The failure direction is the one that removes a capability
 * rather than granting one on a file we could not read.
 */
export function resolutionTableTruncated(): boolean {
  try {
    const path = fileURLToPath(new URL('../../data/bundle/lookup-gate.json', import.meta.url));
    const gate = JSON.parse(readFileSync(path, 'utf8')) as { resolutions_truncated?: unknown };
    return gate.resolutions_truncated === true;
  } catch {
    return false;
  }
}

export default defineConfig({
  srcDir: 'src',
  imports: false,
  manifestVersion: 3,
  /**
   * Vite's module-preload POLYFILL is turned off, and it is a privacy change
   * rather than a size one. The polyfill compiles to a `fetch()` call in the
   * popup chunk — it only ever fetches the extension's own local files, but
   * "the only `fetch` in the shipped code is the k-anonymity lookup in the
   * background worker" is a claim a reader can check with `grep`, and a
   * qualifier on it is worth more than the polyfill. Extension pages run in
   * browsers with native `modulepreload`; the preload hints themselves stay.
   */
  vite: () => ({ build: { modulePreload: { polyfill: false } } }),
  manifest: ({ browser }) => {
    // `apiOrigin()` is called FIRST and unconditionally, so a malformed
    // WXT_API_BASE still fails the build loudly. Gating it behind the
    // truncation flag would turn a typo into a silent no-op on the day the
    // flag flips, which is the worst possible day to discover one.
    const origin = apiOrigin();
    const granted = origin !== null && resolutionTableTruncated();
    return {
      name: 'Disclosed',
      // The Chrome Web Store single-purpose statement, verbatim. It is the
      // description because the description is what a reviewer reads.
      description: 'disclose affiliate relationships on the page you are viewing',
      version: '0.1.0',
      author: { email: CONTACT_EMAIL },
      homepage_url: SITE_ORIGIN,
      ...(browser === 'firefox'
        ? {
            browser_specific_settings: {
              gecko: {
                // Firefox MV3 requires an explicit add-on id.
                id: FIREFOX_ADDON_ID,
                strict_min_version: '109.0',
                // Firefox's data-consent declaration. `none` is not a
                // marketing choice here: there is no account, no identifier,
                // no analytics and no storage of anything a reader browsed,
                // and the k-anonymity lookup is designed so the server cannot
                // learn which URL was asked about (CLAUDE.md HARD RULE 6).
                data_collection_permissions: { required: ['none'] },
              },
            },
          }
        : {}),
      action: { default_title: 'Disclosed', default_popup: 'popup.html' },
      ...(granted ? { host_permissions: [`${origin}/*`] } : {}),
    };
  },
});
