/**
 * classify() — deterministic affiliate-link classification (networks.json v0.2).
 *
 * Encoded rules under test, from CLAUDE.md "Confidence tiers" and the v0.2
 * ruleset:
 *  - confirmed: verified signature — known network domain, or known param +
 *    known merchant pair (on_hosts).
 *  - likely:    a match against any signature still `verified: false`, or a
 *    cloaked / requires-resolution link whose resolution terminates at a
 *    confirmed network.
 *  - possible:  bare ?ref= / ?aff= / ?rfsn= with no corroboration — NEVER badged.
 *  - none:      no signal.
 *  - A signature is not promoted to `confirmed` until validated against >= 3
 *    real observed URLs (`verified: true`). Unverified signatures cap at `likely`.
 *  - A bare corporate domain is never a signature. path_required entries need
 *    the tracking path; a host-only match returns `none`. requires_resolution
 *    hosts (amzn.to) return `none` until resolved.
 *  - Precision over recall: host-scoped params (?sid=, ?irclickid=) never fire
 *    standalone.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  classify,
  createClassifier,
  hasSponsoredRel,
  parseRuleset,
  shouldBadge,
  declaredMerchantOfUrl,
  declaredVendorOfUrl,
  declaredVendorPathSegments,
  PUBLISHER_DECLARED_VENDOR_PARAMS,
  declaredDestinationHost,
  decodeBase64Ascii,
  DECLARED_DESTINATION_REDIRECTORS,
  MATCH_CONFIDENCE,
  PUBLISHER_DECLARED_DIRECT_NETWORK,
  PUBLISHER_DECLARED_NETWORK,
  RESOLUTION_CONFIDENCE_FACTOR,
  type Classification,
  type Ruleset,
} from '../src/index.js';

/**
 * A ruleset with one irrelevant entry: enough to run classify(), with nothing
 * in it that could match an ncls1.com URL. Used to show the declared-
 * destination rate key moves no tier.
 */
const MINIMAL: Ruleset = parseRuleset({
  version: 'test-minimal',
  networks: [
    { id: 'cj', name: 'CJ', verified: false, tier_on_match: 'confirmed', host_patterns: ['anrdoezrs.net'] },
  ],
});

const RULES: Ruleset = parseRuleset({
  version: 'test-2',
  networks: [
    {
      id: 'amazon_associates',
      name: 'Amazon Associates',
      verified: true,
      tier_on_match: 'confirmed',
      host_patterns: [],
      requires_resolution: ['amzn.to'],
      param_signatures: [
        { param: 'tag', on_hosts: ['amazon.com', 'amazon.ca'], host_required: true },
        { param: 'ascsubtag', on_hosts: ['amazon.com', 'amazon.ca'], host_required: true },
      ],
    },
    {
      id: 'cj',
      name: 'CJ Affiliate',
      verified: false,
      tier_on_match: 'confirmed',
      host_patterns: ['anrdoezrs.net', 'jdoqocy.com'],
      param_signatures: [
        { param: 'sid', host_required: true, corroboration_only: true },
        { param: 'pid', host_required: true, corroboration_only: true },
      ],
    },
    {
      id: 'impact',
      name: 'Impact.com',
      verified: true,
      tier_on_match: 'confirmed',
      host_patterns: ['*.pxf.io', '*.sjv.io'],
      known_merchant_subdomains: { 'goto.walmart.com': 'Walmart' },
      param_signatures: [{ param: 'irclickid', corroboration_only: true }],
    },
    {
      id: 'shareasale',
      name: 'ShareASale',
      verified: true,
      tier_on_match: 'confirmed',
      host_patterns: ['shareasale.com', '*.shareasale.com'],
      path_patterns: ['/r.cfm', '/u.cfm'],
      path_required: true,
      param_signatures: [{ param: 'merchantID', host_required: true }],
    },
    {
      id: 'avantlink',
      name: 'AvantLink',
      verified: true,
      tier_on_match: 'confirmed',
      host_patterns: ['avantlink.com', '*.avmws.com'],
      path_patterns: ['/click.php'],
      path_required: true,
    },
    {
      id: 'howl',
      name: 'Howl',
      verified: true,
      tier_on_match: 'likely',
      host_patterns: ['howl.link'],
    },
    {
      id: 'refersion',
      name: 'Refersion',
      verified: false,
      tier_on_match: 'possible',
      host_patterns: [],
      param_signatures: [{ param: 'rfsn' }],
    },
    {
      id: 'generic_direct',
      name: 'Direct programs',
      verified: false,
      tier_on_match: 'possible',
      host_patterns: [],
      param_signatures: [{ param: 'ref' }, { param: 'aff' }, { param: 'partner' }],
    },
  ],
  cloak_path_hints: { patterns: ['/go/', '/recommends/', '/out/'] },
});

function kinds(c: Classification): string[] {
  return c.evidence.map((e) => e.kind);
}

describe('classify: confirmed tier (verified signatures)', () => {
  it('classifies known param + known merchant pair as confirmed, with the merchant', () => {
    const c = classify('https://www.amazon.com/dp/B0C1234XYZ?tag=wirecutter-20', RULES);
    expect(c.tier).toBe('confirmed');
    expect(c.network).toBe('amazon_associates');
    expect(c.merchant).toBe('amazon.com');
    expect(c.confidence).toBe(MATCH_CONFIDENCE.confirmed_param);
    expect(kinds(c)).toContain('merchant_param_match');
  });

  it('matches a verified dedicated tracking host as confirmed', () => {
    const c = classify('https://bestbuy.pxf.io/c/123/456/789', RULES);
    expect(c.tier).toBe('confirmed');
    expect(c.network).toBe('impact');
    expect(c.confidence).toBe(MATCH_CONFIDENCE.confirmed_host);
  });

  it('maps known merchant subdomains to a merchant name', () => {
    const c = classify('https://goto.walmart.com/c/2003851/565706/9383?u=x', RULES);
    expect(c.tier).toBe('confirmed');
    expect(c.network).toBe('impact');
    expect(c.merchant).toBe('Walmart');
    expect(kinds(c)).toContain('known_merchant_subdomain');
  });

  it('matches wildcard host patterns on subdomains only', () => {
    expect(classify('https://bestbuy.pxf.io/c/1', RULES).tier).toBe('confirmed');
    expect(classify('https://pxf.io/c/1', RULES).tier).toBe('none');
  });

  it('matches params case-insensitively on host', () => {
    expect(classify('HTTPS://WWW.AMAZON.COM/dp/x?tag=site-20', RULES).tier).toBe('confirmed');
  });
});

describe('classify: v0.2 path_required (corporate + tracking hosts)', () => {
  it('classifies a host+path match as confirmed', () => {
    const c = classify('https://shareasale.com/r.cfm?b=1&u=2&m=3&merchantID=44', RULES);
    expect(c.tier).toBe('confirmed');
    expect(c.network).toBe('shareasale');
    expect(kinds(c)).toContain('corroborating_param');
  });

  it('returns none for a host-only match against a path_required entry', () => {
    expect(classify('https://shareasale.com/', RULES).tier).toBe('none');
    expect(classify('https://www.shareasale.com/aboutus', RULES).tier).toBe('none');
    const about = classify('https://shareasale.com/about', RULES);
    expect(about.tier).toBe('none');
    expect(kinds(about)).toContain('path_required_unmet');
  });

  it('avantlink.com is corporate: /click.php matches, bare host does not', () => {
    expect(classify('https://www.avantlink.com/click.php?tt=cl&mi=1&pw=2', RULES).tier).toBe(
      'confirmed',
    );
    expect(classify('https://www.avantlink.com/', RULES).tier).toBe('none');
  });
});

describe('classify: v0.2 requires_resolution (amzn.to)', () => {
  it('a bare amzn.to link is not evidence: tier none with a hint', () => {
    const c = classify('https://amzn.to/3xYzAbC', RULES);
    expect(c.tier).toBe('none');
    expect(c.network).toBeNull();
    expect(c.confidence).toBe(0);
    expect(kinds(c)).toContain('requires_resolution');
  });

  it('resolving amzn.to to an amazon tag link yields likely', () => {
    const c = classify('https://amzn.to/3xYzAbC', RULES, {
      resolvedUrl: 'https://www.amazon.ca/dp/B09?tag=site-ca-20',
    });
    expect(c.tier).toBe('likely');
    expect(c.network).toBe('amazon_associates');
    expect(c.merchant).toBe('amazon.ca');
    expect(c.confidence).toBeCloseTo(
      RESOLUTION_CONFIDENCE_FACTOR * MATCH_CONFIDENCE.confirmed_param,
      10,
    );
    expect(kinds(c)).toContain('requires_resolution');
    expect(kinds(c)).toContain('resolved_destination');
  });
});

describe('classify: unverified signatures capped at likely (>= 3 observed URLs rule)', () => {
  it('caps an unverified confirmed-tier network at likely, with the cap recorded', () => {
    const c = classify('https://www.anrdoezrs.net/click-8-10?sid=track42', RULES);
    expect(c.tier).toBe('likely');
    expect(c.network).toBe('cj');
    expect(c.confidence).toBe(MATCH_CONFIDENCE.likely_host);
    expect(kinds(c)).toContain('unverified_signature');
    expect(kinds(c)).toContain('corroborating_param');
  });

  it('never promotes a tier_on_match=likely network to confirmed, even verified', () => {
    const c = classify('https://howl.link/abc123', RULES);
    expect(c.tier).toBe('likely');
    expect(c.network).toBe('howl');
    expect(c.confidence).toBe(MATCH_CONFIDENCE.likely_host);
  });
});

describe('classify: precision guards (false positives are brand-ending)', () => {
  it('never matches a host-scoped param standalone (?sid= is session-id noise)', () => {
    const c = classify('https://store.example.com/cart?sid=abc123', RULES);
    expect(c.tier).toBe('none');
    expect(c.network).toBeNull();
    expect(c.confidence).toBe(0);
  });

  it('never matches ?irclickid= on an arbitrary host standalone', () => {
    expect(classify('https://shop.example.com/product?irclickid=xyz', RULES).tier).toBe('none');
  });

  it('does not match the amazon tag param on a non-amazon host', () => {
    expect(classify('https://example.com/page?tag=wirecutter-20', RULES).tier).toBe('none');
  });

  it('requires a non-empty param value', () => {
    expect(classify('https://merchant.example.com/product?ref=', RULES).tier).toBe('none');
  });
});

describe('classify: possible tier (never badged)', () => {
  it('classifies a bare ?ref= as possible with low confidence', () => {
    const c = classify('https://merchant.example.com/product?ref=blog123', RULES);
    expect(c.tier).toBe('possible');
    expect(c.network).toBe('generic_direct');
    expect(c.merchant).toBe('merchant.example.com');
    expect(c.confidence).toBe(MATCH_CONFIDENCE.possible_param);
  });

  it('classifies ?rfsn= on any host as possible', () => {
    const c = classify('https://gymshark.example.com/?rfsn=123.abc', RULES);
    expect(c.tier).toBe('possible');
    expect(c.network).toBe('refersion');
  });

  it('a stronger signal on the same URL wins over the generic param', () => {
    const c = classify('https://www.amazon.com/dp/B0X?tag=site-20&ref=nav', RULES);
    expect(c.tier).toBe('confirmed');
    expect(c.network).toBe('amazon_associates');
    expect(kinds(c)).toContain('possible_param');
  });
});

describe('classify: cloaked paths and server-side resolution', () => {
  it('a cloak path alone is a hint, not evidence: tier none', () => {
    const c = classify('https://reviewsite.example/go/dyson-v15', RULES);
    expect(c.tier).toBe('none');
    expect(c.confidence).toBe(0);
    expect(kinds(c)).toContain('cloak_path_hint');
  });

  it('resolution terminating at a verified confirmed network yields likely', () => {
    const c = classify('https://reviewsite.example/go/dyson-v15', RULES, {
      resolvedUrl: 'https://www.amazon.com/dp/B09XYZ?tag=reviewsite-20',
    });
    expect(c.tier).toBe('likely');
    expect(c.network).toBe('amazon_associates');
    expect(c.merchant).toBe('amazon.com');
    expect(c.confidence).toBeCloseTo(
      RESOLUTION_CONFIDENCE_FACTOR * MATCH_CONFIDENCE.confirmed_param,
      10,
    );
    expect(kinds(c)).toContain('resolved_destination');
  });

  it('resolution terminating at a clean page yields none', () => {
    const c = classify('https://reviewsite.example/go/dyson-v15', RULES, {
      resolvedUrl: 'https://www.dyson.com/vacuum-cleaners/cordless',
    });
    expect(c.tier).toBe('none');
  });

  it('resolution terminating at a possible signal stays possible', () => {
    const c = classify('https://reviewsite.example/go/widget', RULES, {
      resolvedUrl: 'https://merchant.example.com/widget?ref=site',
    });
    expect(c.tier).toBe('possible');
    expect(c.confidence).toBeCloseTo(
      RESOLUTION_CONFIDENCE_FACTOR * MATCH_CONFIDENCE.possible_param,
      10,
    );
  });
});

/**
 * The publisher-declaration rule (docs/LABELING.md §2 rule 5, ruling
 * 2026-09-07). Two observed facts and no inference: a cloak path, and the
 * publisher's own rel="sponsored". Capped at `likely` forever.
 */
/**
 * docs/LABELING.md §6: `verified` is a property of an ENTRY, and an entry
 * verified against five hosts has said nothing about a sixth.
 */
describe('classify: unverified_host_patterns on a VERIFIED entry cap at likely', () => {
  const RULES_U: Ruleset = parseRuleset({
    networks: [
      {
        id: 'impact',
        name: 'Impact',
        verified: true,
        tier_on_match: 'confirmed',
        host_patterns: ['*.pxf.io'],
        unverified_host_patterns: ['*.n5ka.net', '*.o93x.net'],
      },
      {
        id: 'gated',
        name: 'Gated',
        verified: true,
        tier_on_match: 'confirmed',
        host_patterns: ['gated.example'],
        unverified_host_patterns: ['new.example'],
        path_required: true,
        path_patterns: ['/click.php'],
      },
    ],
  });

  it('a confirmed pattern still confirms', () => {
    const c = classify('https://dreame.pxf.io/c/1/2/3', RULES_U);
    expect(c.tier).toBe('confirmed');
    expect(c.network).toBe('impact');
  });

  it('an unverified pattern on the same VERIFIED entry is capped at likely', () => {
    for (const url of ['https://avocadomattress.n5ka.net/c/1/2/3', 'https://bestbuyca.o93x.net/c/1/2/3']) {
      const c = classify(url, RULES_U);
      expect(c.tier).toBe('likely');
      expect(c.network).toBe('impact');
      expect(kinds(c)).toContain('unverified_signature');
      expect(c.evidence.find((e) => e.kind === 'unverified_signature')?.pattern).toMatch(/n5ka|o93x/);
    }
  });

  it('an unverified pattern obeys the entry\'s path constraint exactly as a verified one does', () => {
    expect(classify('https://new.example/click.php?x=1', RULES_U).tier).toBe('likely');
    expect(classify('https://new.example/about', RULES_U).tier).toBe('none');
  });

  it('an entry with no unverified patterns is unaffected', () => {
    expect(classify('https://dreame.pxf.io/x', RULES).tier).toBe('confirmed');
  });
});

describe('classify: publisher_declared — rel="sponsored" on the PUBLISHER\'S OWN domain', () => {
  const ARTICLE = 'https://www.publisher.example/best-headphones-2026';
  const declared = (url: string, rel: string | null, sourceUrl = ARTICLE): Classification =>
    classify(url, RULES, { rel, sourceUrl });

  it('same registrable domain PLUS rel=sponsored badges as likely under the reserved id', () => {
    const c = declared('https://publisher.example/out/link/123', 'noreferrer sponsored');
    expect(c.tier).toBe('likely');
    expect(c.network).toBe(PUBLISHER_DECLARED_NETWORK);
    expect(c.confidence).toBe(MATCH_CONFIDENCE.likely_declared);
    expect(shouldBadge(c.tier)).toBe(true);
    expect(kinds(c)).toContain('publisher_declared');
  });

  it('THE RULING: no cloak path is required — a subdomain redirector badges', () => {
    // cc.cnet.com/v1/otc/… from a cnet.com article. `/v1/otc/` is on no
    // cloak-path list and never will be; the domain is the evidence.
    const c = classify(
      'https://cc.cnet.com/v1/otc/04Yxjj1rHOmYAxbnVDhvKNn?merchant=02zLDwCq',
      RULES,
      { rel: 'sponsored', sourceUrl: 'https://www.cnet.com/tech/best-headphones/' },
    );
    expect(c.tier).toBe('likely');
    expect(c.network).toBe(PUBLISHER_DECLARED_NETWORK);
    expect(c.merchant).toBe('02zLDwCq');
    expect(kinds(c)).toContain('publisher_declared');
    expect(kinds(c)).not.toContain('cloak_path_hint');
  });

  it('a bare publisher path with rel=sponsored badges — the path never mattered', () => {
    const c = declared('https://publisher.example/deals/spring-sale', 'sponsored');
    expect(c.tier).toBe('likely');
    expect(c.network).toBe(PUBLISHER_DECLARED_NETWORK);
  });

  it('NEGATIVE: a same-domain nav link WITHOUT rel=sponsored does not badge', () => {
    expect(declared('https://publisher.example/about/staff', null).tier).toBe('none');
    expect(declared('https://publisher.example/about/staff', 'nofollow noopener').tier).toBe('none');
    // including on a cloak-shaped path: the path alone was never evidence
    expect(declared('https://publisher.example/out/link/123', null).tier).toBe('none');
    expect(declared('https://publisher.example/go/deal', 'nofollow').tier).toBe('none');
    // and with no opts at all — the rule cannot fire without the crawler
    // passing what it observed on the page
    expect(classify('https://publisher.example/out/link/123', RULES).tier).toBe('none');
  });

  it('NEGATIVE: a cross-domain merchant with rel=sponsored is possible, NOT likely', () => {
    const c = declared('https://www.dyson.com/vacuum-cleaners/cordless', 'sponsored');
    expect(c.tier).toBe('possible');
    expect(c.network).toBe(PUBLISHER_DECLARED_DIRECT_NETWORK);
    expect(c.confidence).toBe(MATCH_CONFIDENCE.possible_declared);
    expect(shouldBadge(c.tier)).toBe(false);
    expect(kinds(c)).toContain('publisher_declared_direct');
    expect(kinds(c)).not.toContain('publisher_declared');
  });

  it('NEGATIVE: a cross-domain CLOAK-SHAPED path with rel=sponsored is also only possible', () => {
    // The five /shop/ URLs this ruling moved out of `likely`: a merchant's own
    // storefront path, on the merchant's own domain, marked sponsored by the
    // publisher. Nothing about it is the publisher's redirector.
    for (const url of [
      'https://austinair.com/shop/healthmate/',
      'https://www.theobjectcollective.com.au/shop/p/the-pucci-pet-bowls-and-tray',
      'https://play.date/shop/',
      'https://www.brushwithbamboo.com/shop/bamboo-toothbrush-adult/',
      'https://www.onepeloton.com/shop/tread/tread-basics-package-us',
    ]) {
      const c = classify(url, RULES, { rel: 'sponsored', sourceUrl: 'https://nymag.com/strategist/article/x.html' });
      expect(c.tier, url).toBe('possible');
      expect(c.network, url).toBe(PUBLISHER_DECLARED_DIRECT_NETWORK);
      expect(shouldBadge(c.tier), url).toBe(false);
    }
  });

  it('a subdomain of the article host, and the article on www, both reduce alike', () => {
    for (const [link, source] of [
      ['https://cc.cnet.com/v1/otc/x', 'https://www.cnet.com/a'],
      ['https://www.cnet.com/out/x', 'https://cnet.com/a'],
      ['https://cnet.com/out/x', 'https://www.cnet.com/a'],
      ['https://deals.shop.cnet.com/x', 'https://www.cnet.com/a'],
    ] as const) {
      expect(classify(link, RULES, { rel: 'sponsored', sourceUrl: source }).tier, link).toBe('likely');
    }
  });

  it('NEGATIVE: rel token matching is exact — "sponsoredcontent" is not a declaration', () => {
    expect(declared('https://publisher.example/out/x', 'sponsoredcontent').tier).toBe('none');
    expect(declared('https://publisher.example/out/x', 'unsponsored').tier).toBe('none');
    expect(hasSponsoredRel('sponsored')).toBe(true);
    expect(hasSponsoredRel('SPONSORED,nofollow')).toBe(true);
    expect(hasSponsoredRel('nofollow ugc sponsored')).toBe(true);
    expect(hasSponsoredRel('sponsoredcontent')).toBe(false);
    expect(hasSponsoredRel(null)).toBe(false);
    expect(hasSponsoredRel(undefined)).toBe(false);
  });

  it('takes the merchant from a declared merchant= param, and null when absent', () => {
    expect(declared('https://publisher.example/out/link/1?merchant=Amazon', 'sponsored').merchant).toBe(
      'Amazon',
    );
    expect(
      declared('https://publisher.example/out/link/1?merchant=Best%20Buy', 'sponsored').merchant,
    ).toBe('Best Buy');
    // an opaque id is a declaration too — recorded verbatim, never resolved
    expect(declared('https://publisher.example/out/1?merchant=0359gHzS', 'sponsored').merchant).toBe(
      '0359gHzS',
    );
    expect(declared('https://publisher.example/out/link/1', 'sponsored').merchant).toBeNull();
    expect(declared('https://publisher.example/out/link/1?merchant=', 'sponsored').merchant).toBeNull();
    // and the exported reader agrees with the classifier, byte for byte
    expect(declaredMerchantOfUrl('https://publisher.example/out/1?merchant=Best%20Buy')).toBe('Best Buy');
    expect(declaredMerchantOfUrl('not a url')).toBeNull();
  });

  it('reads the four vendor parameters, merchant= first — ruling 2026-09-08c', () => {
    expect([...PUBLISHER_DECLARED_VENDOR_PARAMS]).toEqual(['merchant', 'name', 'brand', 'vendor']);
    const u = 'https://www.top10vpn.com/goto/?type=ed&name=nordvpn&clicktype=cta';
    expect(declaredVendorOfUrl(u)).toEqual({ param: 'name', value: 'nordvpn' });
    expect(declaredVendorOfUrl('https://p.example/go?brand=Acme')).toEqual({
      param: 'brand',
      value: 'Acme',
    });
    expect(declaredVendorOfUrl('https://p.example/go?vendor=Acme')).toEqual({
      param: 'vendor',
      value: 'Acme',
    });
    // merchant= wins wherever both are present, so a URL that read one way
    // before the widening reads exactly the same way after it.
    expect(declaredVendorOfUrl('https://p.example/go?name=x&merchant=Walmart')).toEqual({
      param: 'merchant',
      value: 'Walmart',
    });
    expect(declaredVendorOfUrl('https://p.example/go?name=')).toBeNull();
    expect(declaredVendorOfUrl('https://p.example/go')).toBeNull();
    expect(declaredVendorOfUrl('not a url')).toBeNull();
  });

  it('reads path segments as vendor candidates, whole-segment only — ruling 2026-09-08d', () => {
    expect(declaredVendorPathSegments('https://security.org/go/keeper')).toEqual(['go', 'keeper']);
    expect(declaredVendorPathSegments('https://cyberinsider.com/go/nordvpn/')).toEqual([
      'go',
      'nordvpn',
    ]);
    // percent-decoded and lowercased, so a publisher's own encoding is not a
    // second rule
    expect(declaredVendorPathSegments('https://p.example/go/Hide%2Eme')).toEqual(['go', 'hide.me']);
    // A suffixed slug is reported AS ITSELF and never split. The mapping
    // lookup in the rate layer is what declines it, and that is the whole
    // point: `surfshark-antivirus` is a different product from the VPN whose
    // rate card we hold, and splitting on the hyphen would price it anyway.
    expect(declaredVendorPathSegments('https://security.org/go/surfshark-antivirus')).toEqual([
      'go',
      'surfshark-antivirus',
    ]);
    expect(declaredVendorPathSegments('https://p.example/')).toEqual([]);
    expect(declaredVendorPathSegments('not a url')).toEqual([]);
  });

  it('a path segment moves NO tier and NO badge either — ruling 2026-09-08d', () => {
    // cyberinsider.com and security.org write a vendor name into /go/ and
    // mark NOTHING sponsored. The name is a rate key; it is not evidence of
    // payment, and the classifier must be blind to it.
    const withVendor = declared('https://publisher.example/go/nordvpn', 'nofollow noopener');
    const without = declared('https://publisher.example/go/x7a2', 'nofollow noopener');
    expect(withVendor.tier).toBe(without.tier);
    expect(shouldBadge(withVendor.tier)).toBe(false);
    expect(withVendor.merchant).toBeNull();
  });

  it('a vendor parameter moves NO tier, NO badge and NO merchant on the classification', () => {
    // The guard that makes the widening safe lives in the rate layer, not
    // here: `declaredVendorOfUrl` reports what the publisher wrote, and
    // whether it names anyone is decided by data/rates. The CLASSIFIER is
    // untouched — `name=` is not a signature and is not evidence of payment.
    const withName = declared('https://publisher.example/goto/?name=nordvpn', 'sponsored');
    const without = declared('https://publisher.example/goto/?x=1', 'sponsored');
    expect(withName.tier).toBe(without.tier);
    expect(withName.merchant).toBeNull();
    expect(without.merchant).toBeNull();
  });

  it('can NEVER reach confirmed — a declaration is not a verified signature', () => {
    for (const rel of ['sponsored', 'sponsored nofollow', 'noreferrer,sponsored']) {
      for (const path of ['/go/x', '/out/x', '/recommends/x', '/anything/at/all']) {
        const c = declared(`https://publisher.example${path}?merchant=Amazon`, rel);
        expect(c.tier).toBe('likely');
      }
    }
  });

  it('a real signature on the same URL outranks the declaration', () => {
    // The link is also a verified Impact host: the signature wins, so the
    // network reported is the one we can actually evidence.
    const c = classify('https://dreame.pxf.io/out/abc', RULES, {
      rel: 'sponsored',
      sourceUrl: ARTICLE,
    });
    expect(c.tier).toBe('confirmed');
    expect(c.network).toBe('impact');
    // the declaration is still recorded in the audit trail — as the DIRECT
    // kind, because dreame.pxf.io is not the publisher's own domain
    expect(kinds(c)).toContain('publisher_declared_direct');
  });

  it('a resolution outranks the declaration and names the real merchant', () => {
    const c = classify('https://publisher.example/out/link/9?merchant=Amazon', RULES, {
      rel: 'sponsored',
      sourceUrl: ARTICLE,
      resolvedUrl: 'https://www.amazon.com/dp/B09XYZ?tag=reviewsite-20',
    });
    expect(c.tier).toBe('likely');
    expect(c.network).toBe('amazon_associates');
    expect(c.merchant).toBe('amazon.com');
  });

  it('an unattributable declaration is RECORDED and never classified', () => {
    // rel observed, but no source article was passed — the classifier cannot
    // answer "whose domain is this", so it answers nothing and says so.
    const c = classify('https://publisher.example/out/link/1', RULES, { rel: 'sponsored' });
    expect(c.tier).toBe('none');
    expect(c.network).toBeNull();
    expect(kinds(c)).toContain('publisher_declared_unattributable');
  });

  it('BOTH reserved ids can never be claimed by a networks.json entry', () => {
    for (const id of [PUBLISHER_DECLARED_NETWORK, PUBLISHER_DECLARED_DIRECT_NETWORK]) {
      expect(() =>
        parseRuleset({
          networks: [{ id, name: 'x', verified: true, tier_on_match: 'confirmed' }],
        }),
      ).toThrow(new RegExp(id));
    }
  });
});

describe('classify: no signal / invalid input never throws', () => {
  it('returns none for a URL with no signal', () => {
    const c = classify('https://www.amazon.com/dp/B0C1234XYZ', RULES);
    expect(c).toEqual({
      tier: 'none',
      network: null,
      merchant: null,
      confidence: 0,
      evidence: [],
    });
  });

  it('returns none for unparseable input', () => {
    const c = classify('not a url at all', RULES);
    expect(c.tier).toBe('none');
    expect(c.confidence).toBe(0);
  });

  it('returns none for non-http(s) schemes', () => {
    expect(classify('mailto:x@example.com', RULES).tier).toBe('none');
    expect(classify('javascript:void(0)', RULES).tier).toBe('none');
  });
});

describe('shouldBadge encodes the badging rule', () => {
  it('badges confirmed and likely, never possible or none', () => {
    expect(shouldBadge('confirmed')).toBe(true);
    expect(shouldBadge('likely')).toBe(true);
    expect(shouldBadge('possible')).toBe(false);
    expect(shouldBadge('none')).toBe(false);
  });
});

describe('parseRuleset validation', () => {
  it('rejects non-objects and missing networks', () => {
    expect(() => parseRuleset(null)).toThrow();
    expect(() => parseRuleset('nope')).toThrow();
    expect(() => parseRuleset({})).toThrow();
  });

  it('rejects malformed network entries', () => {
    expect(() => parseRuleset({ networks: [{ id: 'x' }] })).toThrow();
    expect(() =>
      parseRuleset({
        networks: [{ id: 'x', name: 'X', verified: false, tier_on_match: 'certain' }],
      }),
    ).toThrow();
    expect(() =>
      parseRuleset({
        networks: [
          { id: 'x', name: 'X', verified: false, tier_on_match: 'possible', param_signatures: [{}] },
        ],
      }),
    ).toThrow();
  });

  it('rejects path_required with no path_patterns to satisfy', () => {
    expect(() =>
      parseRuleset({
        networks: [
          {
            id: 'x',
            name: 'X',
            verified: true,
            tier_on_match: 'confirmed',
            host_patterns: ['x.com'],
            path_required: true,
          },
        ],
      }),
    ).toThrow(/path_patterns/);
  });
});

describe('the real seed data (data/networks.json v0.2)', () => {
  const seed: Ruleset = parseRuleset(
    JSON.parse(readFileSync(new URL('../../../data/networks.json', import.meta.url), 'utf8')),
  );
  const seedClassify = createClassifier(seed);

  it('parses under the strict ruleset validator', () => {
    expect(seed.version).toBe('0.2.0-seed');
    expect(seed.networks.length).toBeGreaterThan(10);
  });

  it('REGRESSION: impact.com/about classifies as none (corporate domain removed in v0.2)', () => {
    const c = seedClassify('https://impact.com/about');
    expect(c.tier).toBe('none');
    expect(c.network).toBeNull();
  });

  it('REGRESSION: other stripped corporate domains no longer match', () => {
    for (const url of [
      'https://partnerize.com/en/about',
      'https://viglink.com/',
      'https://skimresources.com/',
      'https://flexoffers.com/contact',
      'https://linksynergy.com/',
    ]) {
      expect(seedClassify(url).tier).toBe('none');
    }
  });

  it('REGRESSION: a bare amzn.to link is none until resolved', () => {
    expect(seedClassify('https://amzn.to/3abc').tier).toBe('none');
    expect(
      seedClassify('https://amzn.to/3abc', {
        resolvedUrl: 'https://www.amazon.com/dp/B0?tag=x-20',
      }).tier,
    ).toBe('likely');
  });

  /**
   * DRIFT GUARD over the docs/LABELING.md §6 promotions.
   *
   * The lists are written out rather than read from the data on purpose:
   * reading them from the file would make the test agree with whatever the
   * file says, which is precisely the self-validation §6 exists to prevent.
   * A further promotion must fail here and be ratified deliberately.
   */
  /** Promoted by HUMAN signature confirmation (commit 5c52470). */
  const HUMAN_CONFIRMED = ['amazon_associates', 'impact', 'button'] as const;
  /**
   * Promoted by AGENT signature confirmation (§6 ruling 2026-09-07, commit
   * 0beec76). A SEPARATE list, not an addition to the one above: a badged
   * tier an LLM rater confirmed is a different claim from one a person
   * checked, `verified_basis` keeps them apart in the data forever, and the
   * drift guard is the last place that should blur them.
   *
   * `cj` and `partnerboost` added 2026-09-08 — screened blind by a rater that
   * had seen no prior answer, on the brief whose evidence line was fixed the
   * same day (docs/LABELING.md §6). Both had gone unscreened until then for a
   * reason that had nothing to do with the rule: §6 requires >= 4 distinct
   * attributed URLs and each had 3. The corpus expansion took them to 39 and 7.
   *
   * `nucleuslinks` added 2026-09-08b — the FIRST screen of `ncls1.com`, whose
   * 1,030 corpus links were `possible` before it and are `confirmed` after it.
   * Screened blind by a rater that had seen no prior answer and no CLAUDE.md,
   * on a brief that cited the operator's own pages with their provenance and
   * did not tell the rater what they meant. **No link on this host has ever
   * been followed** — `ncls1.com/robots.txt` is an explicit blanket
   * `Disallow: /` — so this signature rests on URL structure and on cited
   * third-party claims, never on an observed destination.
   *
   * **The majority of signatures verified in this file are an AI rater's
   * word, and this list is the place that stays legible about it.** The count
   * of agent-confirmed signatures now exceeds the human-confirmed count;
   * `K_human` on the label side is still 0.
   *
   * `merchant_affiliate_endpoint` added 2026-09-08d — five dedicated
   * subdomains, each operated by the merchant whose product the link sells,
   * each on a REQUIRED tracking path. CLAUDE.md host_pattern rule (b): the
   * bare corporate domains (`nordvpn.com`, `surfshark.com`, …) are NOT in the
   * entry and must never be. Unlike `nucleuslinks`, this one rests on hops we
   * actually OBSERVED: 79 of 79 distinct same-host cloaks on `top10vpn.com`
   * and `cyberinsider.com` resolved server-side and cookieless, and the
   * structural evidence is a per-publisher identifier that differs between
   * the two publishers and is constant within each (`go.nordvpn.net/aff_c`
   * carries `aff_id=624` from one and `aff_id=2523` from the other). The
   * entry names no affiliate PLATFORM: the `/aff_c` shape is recognisable and
   * we have not established whose it is. docs/RESOLVER-SCOPE.md §6.
   *
   * **FIVE of eight signatures verified in this file are now an AI rater's
   * word**, and the sentence above is updated rather than left to go stale.
   */
  const AGENT_CONFIRMED = [
    'georiot',
    'cj',
    'partnerboost',
    'nucleuslinks',
    'merchant_affiliate_endpoint',
  ] as const;

  it('exactly the ratified signatures are verified in the seed data', () => {
    const verified = seed.networks.filter((n) => n.verified).map((n) => n.id).sort();
    expect(verified).toEqual([...HUMAN_CONFIRMED, ...AGENT_CONFIRMED].sort());
  });

  it('every verified signature records WHICH rater confirmed it', () => {
    const raw = JSON.parse(
      readFileSync(new URL('../../../data/networks.json', import.meta.url), 'utf8'),
    ) as { networks: { id: string; verified_basis?: string }[] };
    const basis = new Map(raw.networks.map((n) => [n.id, n.verified_basis]));
    for (const id of HUMAN_CONFIRMED) expect(basis.get(id), id).toBe('human_signature_confirmation');
    for (const id of AGENT_CONFIRMED) expect(basis.get(id), id).toBe('agent_signature_confirmation');
  });

  it('an UNVERIFIED signature is capped at likely, never confirmed', () => {
    // The cap is what keeps a badge off a rule no human has ever checked.
    // `cj` left this list on 2026-09-08 when a rater confirmed it. It is
    // replaced rather than simply removed: a cap test that shrinks each time a
    // signature is promoted ends up testing nothing.
    const unverified: [string, string][] = [
      ['https://click.linksynergy.com/deeplink?id=x&mid=1&murl=https%3A%2F%2Fexample.com', 'rakuten'],
      ['https://shareasale.com/r.cfm?b=1&u=2&m=3', 'shareasale'],
      ['https://www.awin1.com/cread.php?awinmid=1&awinaffid=2', 'awin'],
      ['https://www.pjatr.com/t/1-2-3-4', 'pepperjam'],
      ['https://go.skimresources.com/?id=1&url=https%3A%2F%2Fexample.com', 'skimlinks'],
    ];
    for (const [url, network] of unverified) {
      const c = seedClassify(url);
      expect(c.network, url).toBe(network);
      expect(c.tier, url).toBe('likely');
    }
  });

  /**
   * P1 of docs/NYMAG-MECHANISM.md §6, ratified 2026-09-07. `prf.hn` is a
   * CLAUDE.md class (a) dedicated redirect host, and the wildcard is the same
   * claim about the same host — hostMatchesPattern() strips only `www.`, so
   * without it `www.prf.hn` matched and `glacier.prf.hn` did not.
   *
   * The CAP is the load-bearing half: `partnerize` carries verified: false,
   * so every one of these is `likely`. A wildcard that shipped `confirmed` on
   * subdomains nobody screened is exactly what §6 exists to stop.
   */
  it('the *.prf.hn wildcard matches subdomains AND the apex, all capped at likely', () => {
    for (const host of ['prf.hn', 'www.prf.hn', 'glacier.prf.hn', 'philipsglobal.prf.hn']) {
      const c = seedClassify(`https://${host}/click/camref:1011l9tPn/destination:https%3A%2F%2Fx.com`);
      expect(c.network, host).toBe('partnerize');
      expect(c.tier, host).toBe('likely');
      expect(c.evidence.some((e) => e.kind === 'unverified_signature'), host).toBe(true);
    }
  });

  it('a human-confirmed signature reaches confirmed', () => {
    const amazon = seedClassify('https://www.amazon.com/dp/B0?tag=x-20');
    expect(amazon.tier).toBe('confirmed');
    expect(amazon.network).toBe('amazon_associates');

    const walmart = seedClassify('https://goto.walmart.com/c/2003851/565706/9383');
    expect(walmart.tier).toBe('confirmed');
    expect(walmart.network).toBe('impact');
    expect(walmart.merchant).toBe('Walmart');

    const button = seedClassify(
      'https://r.bttn.io/?btn_ref=org-1&btn_url=https%3A%2F%2Fwww.amazon.com%2Fdp%2FB0%3Ftag%3Dx-20',
    );
    expect(button.tier).toBe('confirmed');
    expect(button.network).toBe('button');
  });

  it('enforces path_required on the seed shareasale entry', () => {
    expect(seedClassify('https://shareasale.com/r.cfm?b=1&u=2&m=3').tier).toBe('likely');
    expect(seedClassify('https://shareasale.com/about').tier).toBe('none');
  });

  it('classifies generic direct params as possible', () => {
    const c = seedClassify('https://merchant.example.com/pricing?via=creator');
    expect(c.tier).toBe('possible');
    expect(c.network).toBe('generic_direct');
  });
});

/**
 * DECLARED DESTINATION — ruling 2026-09-07e, docs/NYMAG-MECHANISM.md §6 P3.
 *
 * A rate KEY, never a tier. `classify()` is not involved and returns exactly
 * what it returned before; these tests assert that too.
 */
describe('declaredDestinationHost — two declarations that must agree', () => {
  // o=qljl00&s=131003&b=15394&bkd=backcountry.com
  const ENK_BACKCOUNTRY = 'bz1xbGpsMDAmcz0xMzEwMDMmYj0xNTM5NCZia2Q9YmFja2NvdW50cnkuY29t';
  const ncls1 = (enk: string, d: string): string =>
    `https://ncls1.com/irk?enk=${enk}&subid=nymag.com&d=${encodeURIComponent(d)}`;

  it('returns the host when d= and the decoded bkd= name the same one', () => {
    expect(
      declaredDestinationHost(ncls1(ENK_BACKCOUNTRY, 'https://www.backcountry.com/some-product')),
    ).toBe('backcountry.com');
  });

  it('refuses when the two disagree — a declaration nobody corroborated is not a rate key', () => {
    expect(
      declaredDestinationHost(ncls1(ENK_BACKCOUNTRY, 'https://www.rei.com/some-product')),
    ).toBeNull();
    // The measured case: d= lands on a SUBDOMAIN of what bkd= names. Two of
    // the corpus's 1,030 ncls1 links look like this. They declare nothing
    // rather than be accommodated by a rule invented for them.
    expect(
      declaredDestinationHost(ncls1(ENK_BACKCOUNTRY, 'https://support.backcountry.com/x')),
    ).toBeNull();
  });

  it('refuses when either declaration is missing or unreadable', () => {
    expect(declaredDestinationHost('https://ncls1.com/irk?d=https%3A%2F%2Fetsy.com')).toBeNull();
    expect(declaredDestinationHost(`https://ncls1.com/irk?enk=${ENK_BACKCOUNTRY}`)).toBeNull();
    expect(declaredDestinationHost(ncls1('!!!not-base64!!!', 'https://etsy.com/x'))).toBeNull();
    expect(declaredDestinationHost(ncls1(ENK_BACKCOUNTRY, 'javascript:alert(1)'))).toBeNull();
  });

  it('fires ONLY on a ratified redirector host', () => {
    expect([...DECLARED_DESTINATION_REDIRECTORS].map((r) => r.host)).toEqual(['ncls1.com']);
    expect(
      declaredDestinationHost(
        `https://other-redirector.example/irk?enk=${ENK_BACKCOUNTRY}&d=${encodeURIComponent('https://www.backcountry.com/x')}`,
      ),
    ).toBeNull();
  });

  it('CHANGES NO TIER: the same URL classifies exactly as it did before', () => {
    const url = ncls1(ENK_BACKCOUNTRY, 'https://www.backcountry.com/x');
    // No rel and no source article: no declaration rule can fire at all.
    expect(classify(url, MINIMAL).tier).toBe('none');
    // With the publisher's rel="sponsored" on someone else's domain it is
    // `possible` — unbadged — and the rate key does not move it.
    const declared = classify(url, MINIMAL, {
      rel: 'sponsored,nofollow',
      sourceUrl: 'https://nymag.com/strategist/article/x.html',
    });
    expect(declared.tier).toBe('possible');
    expect(declared.network).toBe(PUBLISHER_DECLARED_DIRECT_NETWORK);
  });
});

describe('decodeBase64Ascii', () => {
  it('decodes printable ASCII', () => {
    expect(decodeBase64Ascii('bz1xbGpsMDAmcz0xMzEwMDM=')).toBe('o=qljl00&s=131003');
  });

  it('refuses anything that is not plainly a base64 ASCII string', () => {
    expect(decodeBase64Ascii('')).toBeNull();
    expect(decodeBase64Ascii('###')).toBeNull();
    // Decodes to bytes outside printable ASCII — declined rather than mangled.
    expect(decodeBase64Ascii('//////8=')).toBeNull();
  });
});
