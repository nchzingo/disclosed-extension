# @disclosed/extension

A Manifest V3 browser extension that marks the affiliate links on the page you
are reading. Chrome, Edge and Firefox from one codebase. MIT licensed — the
`LICENSE` file is in this directory, because an unauditable privacy claim is
worthless.

**Chrome Web Store single-purpose statement:**

> disclose affiliate relationships on the page you are viewing

---

## What it sends

**Nothing. Not one request, ever — and not "by default".**

The manifest declares no permissions and no host permissions, so the extension
cannot reach the network at all. That is not a policy we follow; it is a fact
about what the browser will let this build do.

### Why that is now unconditional

Cloaked links — `amzn.to/…`, a publisher's own `/go/` redirector — used to be
the one thing this extension could not answer on its own, and a build given an
API base would ask a server about them. **The whole table of resolutions now
ships inside the extension**, hash-keyed, in the rules bundle: 1,147 rows and
about 200 KiB of a 533 KiB file. A cloaked link is answered by a SHA-256 and a
map lookup in your own browser.

- The table is keyed by `sha256(url)` and **contains no URL**. A URL you are
  actually looking at can be looked up; the list of URLs cannot be read out of
  the file.
- Rows that have no destination still carry a **reason** — `robots_disallowed`
  (the host's operator published a refusal and we honoured it), `blocked`,
  `not_a_redirect`. "We looked and were told no" and "we never looked" are
  different sentences and you get the right one.
- A cloak the table does not hold stays unmarked. That is the honest state and
  it is where the answer stops.

### The fallback, and the flag that keeps it shut

The bundle carries a flag, `resolutions_truncated`. It goes true only if the
resolution table ever exceeds the 2 MiB cap the bundle builder enforces — at
which point the whole table can no longer ship and the k-anonymity endpoint
below becomes live. **It is `false` today**, and while it is false:

- the content script returns before it can send anything to the background
  worker, and
- `wxt.config.ts` emits **no `host_permissions` entry at all**, even in a build
  given a `WXT_API_BASE`. The browser refuses the request the code has already
  declined to make.

`test/zero-network.test.ts` runs the real content script over every cloaked URL
in the corpus, in a build configured *with* an API base, with `fetch`,
`XMLHttpRequest`, `sendBeacon` and the message channel to the background worker
all spied, and asserts every count is exactly zero.

If the flag ever does go true, the fallback is one request per page:

```
GET https://<api base>/v1/resolve/<five hex characters>
```

- The five characters are the **first five characters of the SHA-256 of the
  cloaked URL**. Five hex characters is one of 1,048,576 buckets.
- There is **no query string, no request body, and no header we set**. The
  request carries `credentials: omit` (no cookies) and
  `referrerPolicy: no-referrer` (the page you are on is not in a `Referer`
  header).
- The server answers with every resolution it holds in that bucket and the
  match is completed in your browser, against the full 64-character hash.
- **The size of that crowd is a function of how many rows the table holds** —
  roughly `rows / 1,048,576`. At the corpus size that made shipping the table
  possible, a bucket holds about one record, which is the measured reason the
  table is shipped instead of queried.

That is the whole of the extension's network behaviour: none of it, today.

## What it never sends

- **Never a URL you visited.** Not to us, not to anyone. The k-anonymity
  prefix is five characters of a hash and the URLs stay in the browser.
- **Never the page's content, title, text, or the links on it.**
- **Never an identifier.** There is no account, no email, no user id, no
  install id, no device id and no cookie.
- **Never analytics, telemetry, error reporting or usage counts.**
- **Never a request to a merchant, an affiliate network, or a redirector.**
  The extension does not follow, prefetch, resolve or fire an outbound link.
  Redirect resolution happens server-side, cookielessly, from our own clean
  IPs, long before you are involved — your browser must never fire the
  affiliate cookie, because hijacking a creator's commission is the thing this
  project exists to expose.

Nothing is written to `localStorage`, `chrome.storage`, IndexedDB or a cookie.
The extension keeps no record of anything you looked at, including in memory
after the tab closes.

## What it does to the page

**It never touches a link.** It does not strip, replace, inject, rewrite,
redirect or fire an affiliate link — not as a feature, not as an option, not
behind a flag. It reads anchors and inserts a small dot **beside** the ones it
marks, in the anchor's parent, after the anchor. Scanned anchors are tracked in
a `WeakSet` rather than tagged with an attribute, so an anchor the extension has
read is byte-identical to one it has not.

`test/hrefs-untouched.test.ts` captures every anchor's `outerHTML`, `href`
attribute, resolved `href`, `rel` and attribute list before the scan and asserts
they are identical after it.

## What gets marked

Classification is `classify()` from `@disclosed/core`, running **on your
device**, against a rules bundle embedded at build time. The bundle is shipped
as **data**: it is never fetched at runtime and never evaluated as code
(Manifest V3 forbids remote code execution).

| Tier | Marked? |
|---|---|
| `confirmed` — verified signature match | Yes, filled dot |
| `likely` — unverified signature, resolved cloak, or the publisher's own `rel="sponsored"` on its own domain | Yes, hollow dot |
| `possible` — a bare `?ref=`, or `rel="sponsored"` pointing at another company's domain | **Never** |
| `none` | No |

`possible` is never marked under any circumstance. `rel="sponsored"` is also
the correct attribute for paid placement that pays no commission at all, so
marking a cross-domain declaration would mark a publisher for complying with
16 CFR 255.

## What the popup shows

**This page** — links marked (by tier), ranked picks detected and how many
carry a marked link, links examined, and where any disclosure text sits
relative to the first marked link. That position is an observation about this
page; it is **not** the publisher's disclosure grade, which is computed over a
whole sample.

**This publisher** — the card summary from the bundle, in one of six states,
never blended and never shown alongside a number they do not entitle:

| State | What it asserts |
|---|---|
| Scored | Above the SPEC §2.2 threshold: median ρ, its 95% CI and `n`, together |
| Not scored — below the article threshold | Our sample is too small. More articles would move it |
| Not scored — no payout variation to correlate | Every priceable pick carries one rate; a rank correlation against a constant is undefined. More articles of the same shape would not change it |
| Not scored — monetization not established | No affiliate mechanism was established on any pick — a statement about what this method observed, not about what the publisher earns |
| Takes no affiliate revenue | `M̄ = 0`: no conflict is structurally possible, so the publisher is not scored |
| No report card | The bundle has no card for this site. We have not measured it |

A median ρ is printed only when the bundle carries one, which it does only
above the publication threshold. Nothing here recomputes, estimates or infers
one.

## Build

```sh
pnpm --filter @disclosed/core build          # the extension imports its dist
pnpm --filter @disclosed/extension test      # vitest + jsdom
pnpm --filter @disclosed/extension typecheck
pnpm --filter @disclosed/extension build     # all three targets
```

Individual targets: `build:chrome`, `build:edge`, `build:firefox`. Output lands
in `.output/{chrome,edge,firefox}-mv3/`, loadable unpacked from
`chrome://extensions` or `about:debugging`. **No store submission is
attempted** — that needs a human.

To regenerate the corpus fixture the trie-parity test runs against:
`pnpm --filter @disclosed/extension build-corpus-fixture`.

## Check it yourself

The claims above are greppable in the built output, which is the point of
shipping the source under MIT. After `pnpm --filter @disclosed/extension build`:

```sh
cd packages/extension
grep -c "fetch(\|XMLHttpRequest\|sendBeacon\|WebSocket\|EventSource" \
  .output/chrome-mv3/content-scripts/content.js     # 0 — the page-side code
                                                    # has no network primitive
grep -o "v1/resolve" .output/chrome-mv3/background.js   # the one endpoint
cat .output/chrome-mv3/manifest.json                # no permissions at all
```

The content script that reads your pages contains no way to make a request:
the k-anonymity lookup lives in the background worker and is dropped from the
content bundle entirely. (`fetch` appears as a *word* in the content script
because the embedded rate table records `fetched_at` provenance on every row.)

And the behavioural check, run against the built artifact rather than the
source — it loads the shipped content script into a page, lets it run, and
asserts the anchors are byte-identical, that markers were nonetheless
inserted, and that nothing reached the network:

```sh
pnpm --filter @disclosed/extension verify-built            # chrome-mv3
node tools/verify-built.mjs firefox-mv3                    # or edge-mv3
```

## Limits, stated here rather than discovered later

- **The resolution API does not exist yet.** `packages/api` is unbuilt, so
  every build ships with `WXT_API_BASE` unset and the k-anonymity path disabled.
  A cloaked link is shown as cloaked with an unknown destination — never as
  unmonetized.
- **The `possible` count in the popup is a floor, not a total.** Links whose
  only signal is a bare `?ref=` are not searched for at all: they can never be
  marked, so hunting for them would be per-link work spent on a number we would
  not act on. The count of `rel="sponsored"` cross-domain links IS complete for
  the links examined, and is reported separately.
- **No commission rate is displayed anywhere in this extension.** The bundle
  carries the rate table with its provenance, but HARD RULE 2's display format
  (`Amazon US paid 4.0% on Electronics as of 2026-07-11 [source]`) is a report
  card's job; a popup showing a naked percentage would be a rate without
  provenance.
- **The whole bundle is inlined into both the content script and the popup**
  (~220 kB each). The content script only needs the signatures; splitting the
  rates and cards out of it is not done.
- **The scan stops at 2,000 anchors per page** and says so when it does.
- **`M̄ = 0` means no affiliate monetization was detected**, not that the
  publisher earns nothing. Display advertising, sponsored placement paid
  outside an affiliate network, subscriptions and licensing are all outside
  what this method observes.

## Layout

```
src/lib/bundle.ts      the embedded rules bundle, validated before use
src/lib/trie.ts        compiled reversed-host trie — a PREFILTER, not a classifier
src/lib/prefilter.ts   trie + the rel="sponsored" declaration, which no trie can see
src/lib/scan.ts        read the page, classify what is admitted, mark what may be marked
src/lib/marker.ts      the dot, in a shadow root, beside the link
src/lib/kanon.ts       the five-character lookup and nothing else
src/lib/cards.ts       the publisher panel: five states, never a reconstructed number
src/lib/panel.ts       the page panel, in sentences
src/entrypoints/       content script, background worker, popup
```
