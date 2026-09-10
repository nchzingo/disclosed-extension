# Chrome Web Store listing — copy this into the form

> **SUBMITTED 2026-09-10. Version 0.1.0, the zero-card package. PENDING REVIEW.**
>
> Google flagged **broad host access** as needing in-depth review. We submitted
> rather than narrowing it — see "What a reviewer is most likely to ask" at the
> foot of this file, which anticipated exactly this question, and
> `docs/launch/DAY-8.md` §9 for the reasoning and for what to do if the item is
> still in review on day 8.
>
> The uploaded package declares `permissions` null, `host_permissions` null and
> `optional_permissions` null. The only broad thing in it is
> `content_scripts.matches`. Do not let a form field or a note anywhere describe
> this extension as requesting host permissions: it requests none, and that is
> the fact the zero-network claim rests on.

Everything a person has to paste into the Developer Dashboard, in the order the
form asks for it. **Nothing here is a claim the built artifact does not already
make**: every sentence below is either in `packages/extension/README.md` or is
readable in the shipped `manifest.json`, and the screenshots were taken from the
real extension running in a real browser rather than drawn.

The same text serves Microsoft Edge Add-ons and addons.mozilla.org, whose forms
ask for the same things under different names. Firefox additionally reads the
`data_collection_permissions` declaration out of the manifest, which is already
set to `none`.

---

## Package

| | |
|---|---|
| Upload | `packages/extension/.output/packages/disclosed-0.1.0-chrome-mv3-store.zip` |
| **Publisher cards embedded** | **0** — verify with `node tools/cards-in-package.mjs <zip>` |
| Resolution rows embedded | 0 |
| Version | `0.1.0` |
| Manifest | V3 |
| Permissions requested | **none** — no `permissions`, no `host_permissions`, no `optional_permissions` |

### The uploaded package carries NO publisher measurement, on purpose

A store listing is publication in exactly the sense SPEC §9 means, and the
seven-day right-of-reply windows have not run. So the package submitted today
embeds a bundle with **`cards: []` and an empty resolution table** — and a
listing that embeds no measurement is not publication at all, which is what lets
the submission go in now and be reviewed while the clock runs.

**The cards arrive in a store UPDATE on day 8**, packaged from the same bundle
the website publishes that morning. `docs/launch/DAY-8.md` §9 is the sequence.

What the store build loses, stated rather than glossed: every site reports "no
report card" (accurate — none has been published), and every cloaked link is
shown as cloaked with an unknown destination rather than answered from the table.
Both are states the extension already has and already explains. **Nothing about
the zero-network claim weakens** — with no table to answer from, the artifact has
every reason to ask and still asks nobody, which `verify-built` asserts directly
when pointed at the store bundle.

Build and package with:

```sh
node packages/extension/tools/store-bundle.mjs          # cards: [] + empty table
cd packages/extension
DISCLOSED_STORE_BUILD=1 npx wxt build -b chrome
DISCLOSED_STORE_BUILD=1 npx wxt build -b edge
DISCLOSED_STORE_BUILD=1 npx wxt build -b firefox
node tools/verify-built.mjs chrome-mv3 --bundle ../../data/bundle/rules-store.json
node tools/cards-in-package.mjs .output/chrome-mv3      # must print 0
node tools/package.mjs --suffix store
```

For the day-8 update, drop `DISCLOSED_STORE_BUILD` and `--suffix`, and
`cards-in-package.mjs` must print 22.

The full (non-store) build is rebuilt with:

```sh
pnpm --filter @disclosed/crawler launch-gate        # must say PASS first
pnpm --filter @disclosed/core build
pnpm --filter @disclosed/extension build
pnpm --filter @disclosed/extension verify-built     # asserts the claims on the artifact
node packages/extension/tools/package.mjs           # zips all three, prints sha256
```

**Use `package.mjs`, not `zip -qr` by hand.** `zip -r` UPDATES an existing
archive instead of replacing it: entries whose names still exist are refreshed,
and entries whose names have gone — a content-hashed chunk from a previous build
— are kept. That produced a 472 KB package containing two popup chunks, one
orphaned from a build eleven hours earlier. `package.mjs` deletes the target
first.

---

## Name

```
Disclosed
```

## Summary (132 characters max)

```
Marks the affiliate links on the page you are reading. Makes no network request. Never modifies a link. Open source.
```

*(115 characters.)*

## Single purpose description

The store asks for one sentence describing the extension's single purpose. It is
the same string that is in the manifest's `description` field, deliberately, so
the two cannot drift:

```
disclose affiliate relationships on the page you are viewing
```

## Category

`Productivity` → `Workflow & Planning`

## Language

English

---

## Detailed description

```
Product-review sites earn a commission on many of the products they recommend.
Which links pay them, and which do not, is not visible while you are reading.

Disclosed marks the links that carry affiliate attribution with a small dot
beside them, and tells you which network and which merchant. That is all it
does.

IT MAKES NO NETWORK REQUEST. NOT "BY DEFAULT".

The manifest declares no permissions and no host permissions, so the browser
will not let this extension reach the network at all. That is not a policy we
are asking you to take on trust; it is a fact about what the browser permits,
and you can read it in the shipped manifest.json in about ten seconds.

Everything it needs is embedded at build time: the network signatures, the rate
table, the report cards, and the whole table of resolved redirects. The
resolution table is keyed by a hash of the URL and contains no URL, so a link
you are actually looking at can be looked up, and the list of links cannot be
read out of the file.

WHAT IT NEVER SENDS

- Never a URL you visited, to us or to anyone.
- Never the page's content, title, text or links.
- Never an identifier. There is no account, no email, no user id, no install
  id, no device id and no cookie.
- Never analytics, telemetry, error reporting or usage counts.
- Never a request to a merchant, an affiliate network, or a redirector. It does
  not follow, prefetch, resolve or fire an outbound link.

Nothing is written to localStorage, chrome.storage, IndexedDB or a cookie. It
keeps no record of anything you looked at, including in memory once the tab is
closed.

IT NEVER TOUCHES A LINK

It does not strip, replace, inject, rewrite, redirect or fire an affiliate link.
Not as a feature, not as an option, not behind a flag. It inserts a dot BESIDE a
link, in the link's parent, after it. A test captures every link's markup,
attributes and destination before the scan and asserts they are identical
afterwards.

This matters beyond good manners. Extensions that overwrite a creator's
affiliate tag with their own take a commission somebody else earned. That
practice is one of the things this project exists to document, and an extension
that did it while claiming to expose it would have nothing left to say.

WHAT GETS MARKED, AND WHAT NEVER DOES

A filled dot means a verified signature match. A hollow dot means a weaker
signal — an unverified signature, a resolved redirect, or the publisher's own
sponsored attribute on its own domain. The two are shown differently because
they are different claims.

A link whose only signal is a bare tracking parameter is NEVER marked, under any
circumstance. Those parameters are used constantly for things that pay nobody a
commission. One wrong mark costs more than a hundred missed links, so where
there is doubt, nothing is marked.

WHAT THE POPUP SHOWS

For the page: how many links were marked and at which confidence, how many
ranked products the page recommends and how many of those carry a marked link,
how many links were examined, and where any disclosure text sits relative to the
first marked link.

For the site: the published report card, in whichever state it is in — including
"we have not measured this site", which is shown differently from "we measured
it and found nothing". A correlation between commission rate and ranking is
shown only where a card carries one, together with its interval and its sample
size. Nothing is recomputed, estimated or inferred.

No commission rate is displayed anywhere in the extension. A rate has to be
shown with the page it was read from and the date it was read; a popup showing a
bare percentage would be a rate without provenance.

OPEN SOURCE, MIT

An unauditable privacy claim is worth nothing. The source is public and the
claims above are greppable in the built output: the shipped manifest has no
permissions block, and the content script that reads your pages contains no
network primitive at all.

https://github.com/nchzingo/disclosed-extension

LIMITS, STATED HERE RATHER THAN FOUND LATER

- A cloaked link the shipped table does not hold stays unmarked. It is shown as
  cloaked with an unknown destination, never as paying nothing.
- The scan stops at 2,000 links on a page, and says so when it does.
- A site with no marked links is a site where no affiliate link was DETECTED,
  not a site that earns nothing. Display advertising, placement paid outside an
  affiliate network, subscriptions and licensing are all outside what this sees.
- The report cards cover a small number of sites so far. Most sites will show
  "no report card", which is the accurate answer.
```

---

## Image assets

Generated by `node packages/extension/tools/store-images.mjs`, into
`packages/extension/store/images/`. Flat fills and type only — no gradient, no
stock imagery, no publisher name, and no figure. A promo tile carrying a number
would be a measurement published outside the page that explains it.

| Field | File | Size |
|---|---|---|
| Store icon | `icon-128.png` | 128×128 |
| Small promo tile | `promo-small.png` | 440×280 |
| Marquee promo tile | `promo-marquee.png` | 1400×560 |

**The mark is the product's own.** `src/lib/marker.ts` puts a dot beside each
link it marks — `#1a5fb4`, filled for a verified signature match, hollow for a
weaker one — and the icon is those two dots and nothing else. The palette and the
wordmark's letterspacing come from the site's design tokens.

**`icon-128.png` is the manifest's `icons.128`, byte for byte.** One file doing
two jobs; `test/manifest.test.ts` asserts the bytes are identical, that every
file the manifest names is actually in the package, and that each icon's real
pixel dimensions match the size it is declared under.

The generator refuses to write an image whose content does not fit its canvas,
naming what overflowed. That is not decoration: the marquee's three claims
overflowed twice while it was being written, and only looking at the picture
caught it.

## Screenshots

All three are 1280×800 PNG, in `packages/extension/.output/store-assets/`,
regenerate with `node packages/extension/tools/screenshots.mjs`.

| File | Caption to paste |
|---|---|
| `1-marked-article.png` | A review page with the affiliate links marked. The links that pay nobody are left alone. |
| `2-popup.png` | What the extension found on the page, and the published card for the site. |
| `3-manifest.png` | The shipped manifest asks for no permissions, so the browser will not let it reach the network. |

**They are pictures of the running extension, not mock-ups.** The script launches
Chromium with the built `.output/chrome-mv3` loaded unpacked and serves a
synthetic review article over http; every dot in image 1 was placed by the
shipped bytes and every number in image 2 came from the real content script.

The demo article is synthetic and says so on its face. A screenshot of a real
publisher's page would put someone else's masthead in our store listing beside a
measurement about them, which is the thing the right-of-reply rule exists to
prevent.

One piece of scaffolding is in image 2 and is named here because it is in the
picture: an automated browser cannot open a browser-action popup, so the popup
was loaded as an ordinary tab, and the one call asking "which tab is active" was
pointed at the article instead of at itself. Everything after that is real.

---

## Privacy practices tab

This is the section that fails a review if it is answered loosely. Every answer
below is checkable against the uploaded package.

### Single purpose

> This extension has one purpose: to disclose affiliate relationships on the
> page you are viewing. It reads the links on the page you have open, marks the
> ones that carry affiliate attribution, and reports what it found. It has no
> second feature.

### Permission justifications

**There are no permissions to justify.** The manifest declares no `permissions`
array, no `host_permissions`, and no `optional_permissions`. If the form
requires a note, use:

> This extension requests no permissions of any kind. The content script reads
> the page it is already injected into, and the popup communicates with that
> content script. Neither needs a permission, and the absence of one is what
> makes the extension's zero-network-request claim enforceable by the browser
> rather than a promise.

**`content_scripts` matches `http://*/*` and `https://*/*`** — the store treats
broad match patterns as needing justification even though they are not a
permission:

> The extension marks affiliate links on any product-review page a reader
> chooses to read, and review pages are published on arbitrary domains. A
> narrower match list would be a list of sites we had decided to cover, which
> would both miss most of the web and quietly tell us nothing, since the
> extension reports nothing to us either way. The content script has no way to
> make a network request, so a broad match grants no data collection: the pages
> it reads are read in the reader's own browser and are never transmitted.

### Data usage — the certification checkboxes

Tick **none** of the data-collection categories. For the record, the exhaustive
answer:

| Category the form asks about | Collected? |
|---|---|
| Personally identifiable information | **No** |
| Health information | **No** |
| Financial and payment information | **No** |
| Authentication information | **No** |
| Personal communications | **No** |
| Location | **No** |
| Web history | **No** |
| User activity (clicks, mouse position, scroll, keystrokes) | **No** |
| Website content (text, images, sounds, files) | **No** |

The three certifications, all of which are true:

- ☑ I do not sell or transfer user data to third parties, outside of the
  approved use cases.
- ☑ I do not use or transfer user data for purposes that are unrelated to my
  item's single purpose.
- ☑ I do not use or transfer user data to determine creditworthiness or for
  lending purposes.

**The extension collects nothing, so nothing is transferred, sold or used.** It
transmits no data anywhere, and the manifest is what enforces that.

### Privacy policy URL

```
https://disclosed.info/extension/
```

That page states what the extension does, what it never sends, what it never
does to a link, and how to check each claim against the built output. It loads
no third-party resource, sets no cookie and carries no analytics.

### Remote code

> **No.** The extension executes no remote code. The rules bundle is shipped as
> data inside the package, is never fetched at runtime, and is never evaluated.
> Manifest V3 forbids remote code execution and this build has nothing to
> execute even if it did not.

---

## Support and contact

| Field | Value |
|---|---|
| Support email | `bot@disclosed.info` |
| Website | `https://disclosed.info` |
| Support URL | `https://disclosed.info/extension/` |
| Repository | `https://github.com/nchzingo/disclosed-extension` |
| Licence | MIT |

---

## What a reviewer is most likely to ask, and the answer

**"Why does a link-marking extension need to run on every site?"** Because review
pages are published on arbitrary domains, and the extension reports nothing back
to us from any of them. The match pattern grants no data collection here: with no
host permission and no network primitive in the content script, a page it reads
cannot leave the browser.

**"Why not `activeTab`?"** — asked in substance by the review flag on 2026-09-10.
`activeTab` grants access only after the user invokes the extension, so nothing
would be marked until a reader clicked the toolbar icon. The product is *see the
affiliate links on the page you are reading*; a reader who does not know to click
sees an unmarked page and concludes there is nothing to see. That is not merely
worse usability — it under-reports monetization, in the direction that flatters
publishers, which is the one direction this project must not fail in.

**"The content script is 640 kB. What is in it?"** The rules bundle — network
signatures, the rate table with provenance, the report cards, and the resolution
table — all shipped as data so that no lookup has to be a request. It is the
direct cost of the zero-network-request design, and it is stated in the README
rather than hidden.

**"Is `fetch` in the content script?"** The word appears; the call does not. The
embedded rate table records a `fetched_at` provenance field on every row. A test
drives the built content script over every cloaked URL in the corpus with
`fetch`, `XMLHttpRequest`, `sendBeacon` and the message channel all instrumented
and asserts every count is zero.
