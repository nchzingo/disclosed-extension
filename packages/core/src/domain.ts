/**
 * Registrable domain (eTLD+1) — the identity test behind the publisher
 * declaration rule (docs/LABELING.md §2 rule 5, ruling 2026-09-07b).
 *
 * A publisher's own outbound redirector is not always on the article's host.
 * Wirecutter cloaks on `www.nytimes.com/wirecutter/out/…` — same host — but
 * CNET cloaks on `cc.cnet.com/v1/otc/…`, a DIFFERENT host under the same
 * registrable domain. Both are the publisher redirecting its own reader, and
 * the question "is this the publisher's own domain" is answered by the
 * registrable domain, not by the host and not by a path pattern.
 *
 * Pure string work, zero dependencies, no I/O — like canonical.ts, and for
 * the same reason: `core` must be auditable line by line.
 *
 * ---------------------------------------------------------------------------
 * THE PUBLIC SUFFIX TABLE HERE IS DELIBERATELY PARTIAL, AND THE PARTIALNESS
 * IS SAFE IN EXACTLY ONE DIRECTION.
 *
 * The full Public Suffix List is ~10k lines of data that changes weekly and
 * would be a runtime dependency. We do not carry it. What we carry is a rule
 * that errs toward LONGER suffixes, because of this asymmetry:
 *
 *   - Over-counting suffix labels makes the registrable domain MORE specific,
 *     so two hosts match LESS often, so a badge is WITHHELD. Cost: one link
 *     (CLAUDE.md HARD RULE 3 — a missed detection costs nothing).
 *   - Under-counting suffix labels makes it LESS specific, so two unrelated
 *     hosts can collide — `shop.com.au` and `smh.com.au` both reducing to
 *     `com.au` — and a FALSE BADGE ships. Cost: the company.
 *
 * So every rule below is written to add suffix labels when unsure, never to
 * remove them, and `sameRegistrableDomain` answers `false` on any input it
 * cannot reduce.
 */

/**
 * Second-level labels that act as a public suffix under a two-letter ccTLD:
 * `co.uk`, `com.au`, `co.jp`, `ac.nz`, `com.br`, `org.za`, …
 *
 * A GENERIC RULE, not an enumeration of country registries — enumerating them
 * would be recall, and a registry we forgot is exactly the collision above.
 * Applied only under a two-letter TLD, where this shape is the norm.
 */
export const CCTLD_SECOND_LEVEL_LABELS: readonly string[] = [
  'ac',
  'biz',
  'co',
  'com',
  'edu',
  'firm',
  'gen',
  'go',
  'gov',
  'gv',
  'id',
  'in',
  'info',
  'int',
  'k12',
  'lg',
  'ltd',
  'me',
  'mil',
  'ne',
  'net',
  'nom',
  'or',
  'org',
  'plc',
  'res',
  'sch',
  'web',
];

/**
 * Multi-label suffixes the ccTLD rule above cannot see, because their TLD is
 * not two letters or their second level is a brand.
 *
 * EXACTLY this list, grown only by ratified amendment on observed evidence —
 * the same discipline docs/LABELING.md applies to its non-commercial domain
 * list. Every entry here is a SHARED HOSTING platform, which is the shape
 * that can actually produce a false badge in this pipeline: a publisher and a
 * merchant who are strangers, sitting on one platform's domain, would
 * otherwise reduce to the same registrable domain and badge each other.
 */
export const MULTI_LABEL_PUBLIC_SUFFIXES: readonly string[] = [
  'bigcartel.com',
  'blogspot.com',
  'ecwid.com',
  'github.io',
  'myshopify.com',
  'squarespace.com',
  'substack.com',
  'wixsite.com',
  'wordpress.com',
];

const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/** Normalised host labels, or null for anything we refuse to reduce. */
function labelsOf(hostname: string): string[] | null {
  if (typeof hostname !== 'string') return null;
  const host = hostname.trim().toLowerCase().replace(/\.$/, '');
  // An IP literal has no registrable domain; a bracketed IPv6 host has no
  // dots to split. Both answer null rather than a wrong reduction.
  if (host === '' || host.includes(':') || host.includes('[') || IPV4.test(host)) return null;
  const labels = host.split('.');
  if (labels.length < 2 || labels.some((l) => l === '')) return null;
  return labels;
}

/**
 * How many trailing labels are the public suffix of this host.
 *
 * Rules applied in order, each of which can only ever LENGTHEN the answer:
 *  1. the default: one label (`.com`, `.date`, `.app`);
 *  2. an explicit shared-hosting suffix from the table above;
 *  3. a two-letter TLD preceded by a generic second-level label.
 */
export function publicSuffixLabelCount(hostname: string): number | null {
  const labels = labelsOf(hostname);
  if (labels === null) return null;
  const host = labels.join('.');
  let count = 1;

  for (const suffix of MULTI_LABEL_PUBLIC_SUFFIXES) {
    if (host === suffix || host.endsWith(`.${suffix}`)) {
      count = Math.max(count, suffix.split('.').length);
    }
  }

  const tld = labels[labels.length - 1]!;
  const second = labels.length >= 2 ? labels[labels.length - 2]! : '';
  if (tld.length === 2 && CCTLD_SECOND_LEVEL_LABELS.includes(second)) {
    count = Math.max(count, 2);
  }

  return count;
}

/**
 * The registrable domain (eTLD+1) of a host, or null when there is none —
 * an IP literal, a malformed host, or a host that IS a public suffix and so
 * has no registrable domain at all (`com.au`, `myshopify.com`).
 *
 * A leading `www.` is not special-cased: it is an ordinary subdomain label
 * and falls away with every other one.
 */
export function registrableDomain(hostname: string): string | null {
  const labels = labelsOf(hostname);
  const suffixLabels = publicSuffixLabelCount(hostname);
  if (labels === null || suffixLabels === null) return null;
  if (labels.length <= suffixLabels) return null;
  return labels.slice(labels.length - suffixLabels - 1).join('.');
}

/**
 * True when two hosts sit under the same registrable domain.
 *
 * Answers `false` — never throws, never guesses — whenever either side has no
 * registrable domain. "We could not reduce this host" must read as "not the
 * publisher's own domain", because the rule that consumes this answer badges
 * on `true`.
 */
export function sameRegistrableDomain(a: string, b: string): boolean {
  const left = registrableDomain(a);
  if (left === null) return false;
  return left === registrableDomain(b);
}

/** The registrable domain of a full URL, or null if it is not an http(s) URL. */
export function registrableDomainOfUrl(rawUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  return registrableDomain(url.hostname);
}
