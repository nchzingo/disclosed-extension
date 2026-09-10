/**
 * The mirror must equal the source.
 *
 * `data/identity.json` is where the domain is written. `src/identity.ts`
 * repeats it, because `core` does no I/O and cannot read the file — so the
 * repetition is a deliberate, asserted one rather than an accidental
 * eleventh copy. If either side is edited alone, this fails.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  API_ORIGIN,
  BOT_PAGE,
  CONTACT_EMAIL,
  DOMAIN,
  FIREFOX_ADDON_ID,
  RETIRED_DOMAIN,
  SITE_ORIGIN,
  USER_AGENT,
} from '../src/identity.js';

const source = JSON.parse(
  readFileSync(join(process.cwd(), '..', '..', 'data', 'identity.json'), 'utf8'),
) as Record<string, string>;

describe('the identity mirror', () => {
  it.each([
    ['domain', DOMAIN],
    ['site_origin', SITE_ORIGIN],
    ['bot_page', BOT_PAGE],
    ['user_agent', USER_AGENT],
    ['contact_email', CONTACT_EMAIL],
    ['api_origin', API_ORIGIN],
    ['firefox_addon_id', FIREFOX_ADDON_ID],
  ])('%s matches data/identity.json', (field, mirrored) => {
    expect(source[field]).toBe(mirrored);
  });

  it('names the retired domain the same way the source file does', () => {
    expect((source._retired as unknown as Record<string, string>).domain).toBe(RETIRED_DOMAIN);
  });
});

describe('every public string is built on the live domain', () => {
  it.each([
    ['SITE_ORIGIN', SITE_ORIGIN],
    ['BOT_PAGE', BOT_PAGE],
    ['USER_AGENT', USER_AGENT],
    ['CONTACT_EMAIL', CONTACT_EMAIL],
    ['API_ORIGIN', API_ORIGIN],
    ['FIREFOX_ADDON_ID', FIREFOX_ADDON_ID],
  ])('%s contains the live domain and not the retired one', (_name, value) => {
    expect(value).toContain(DOMAIN);
    expect(value).not.toContain(RETIRED_DOMAIN);
  });

  it('the retired domain is not the live one', () => {
    expect(RETIRED_DOMAIN).not.toBe(DOMAIN);
  });
});
