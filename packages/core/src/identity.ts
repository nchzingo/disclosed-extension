/**
 * Who we say we are, to everybody outside this repository.
 *
 * These five strings are the whole public identity of the project: the
 * User-Agent every request carries, the page that user agent points at, the
 * address on 22 right-of-reply letters, the API origin, and the Firefox
 * add-on id. They were previously written out by hand in eleven places, and
 * on 2026-09-09 the domain had to change — `disclosed.app` was never ours,
 * it was an aftermarket listing the whole time — which is exactly the event
 * eleven hand-written copies handle badly.
 *
 * `data/identity.json` is the source. This file mirrors it, because `core`
 * has zero runtime dependencies and does no I/O, so it cannot read a file;
 * `test/identity.test.ts` asserts the mirror is equal to it, field by field,
 * and fails if either side moves alone. The shell deploy scripts and the web
 * build read the JSON directly rather than importing anything.
 *
 * `test/no-retired-domain.test.ts` at the repository root then greps every
 * tracked file for the retired domain, so a twelfth hand-written copy cannot
 * be added quietly.
 */

/** The registrable domain. Everything below is built from it or names it. */
export const DOMAIN = 'disclosed.info';

/** The site itself. */
export const SITE_ORIGIN = 'https://disclosed.info';

/**
 * The page the User-Agent points at, and the only page the production build
 * serves besides the placeholder. A crawler naming a URL that does not answer
 * is asking a site operator to take its conduct on trust.
 */
export const BOT_PAGE = 'https://disclosed.info/bot';

/**
 * The honest User-Agent. Sent on every request, never disguised as a browser,
 * and never varied to get a different answer out of a server.
 */
export const USER_AGENT = 'DisclosedBot/1.0 (+https://disclosed.info/bot)';

/** Crawler conduct, block requests and corrections. Printed in every letter. */
export const CONTACT_EMAIL = 'bot@disclosed.info';

/** Where the Worker answers. No current client calls it (CLAUDE.md, privacy §2). */
export const API_ORIGIN = 'https://api.disclosed.info';

/** Firefox requires an explicit add-on id. Never submitted under any other. */
export const FIREFOX_ADDON_ID = 'extension@disclosed.info';

/**
 * The domain this project used to name, and never owned.
 *
 * Kept as a constant rather than deleted because two things still have to be
 * able to say it: the test that proves no live string uses it any more, and
 * the record under `data/`, where every `user_agent` provenance field states
 * what was ACTUALLY SENT at a past moment and is therefore never rewritten.
 */
export const RETIRED_DOMAIN = 'disclosed.app';
