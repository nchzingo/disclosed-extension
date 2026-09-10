/**
 * config.ts — build-time configuration. There is no runtime configuration and
 * no options page, because there is nothing a reader could usefully turn on.
 *
 * `API_BASE` is empty in every build this repo produces. Empty means the
 * k-anonymity lookup is disabled at the source (lib/kanon.ts returns before
 * touching `fetch`) AND that the manifest carries no host permission for it
 * (wxt.config.ts), so the extension is not merely unwilling to make a network
 * request — it is unable to.
 */
export const API_BASE = (import.meta.env.WXT_API_BASE ?? '').trim();

/** True only in a build that was explicitly given an API base. */
export const LOOKUPS_ENABLED = API_BASE !== '';
