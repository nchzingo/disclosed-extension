# Disclosed — browser extension

Marks the affiliate links on the page you are reading. **Makes no network
request of any kind. Never modifies a link.** MIT.

Chrome, Edge and Firefox from one codebase, Manifest V3 on all three.

---

## The claim, and how to check it in about two minutes

### 1. It cannot reach the network, and the browser is what enforces that

```sh
pnpm install
pnpm --filter @disclosed/core build
pnpm --filter @disclosed/extension build
cat packages/extension/.output/chrome-mv3/manifest.json
```

There is no `permissions` array, no `host_permissions` and no
`optional_permissions`. An extension that asks for no host permission cannot
make a cross-origin request — not because we promise not to, but because the
browser refuses. That is the whole of the privacy architecture, and it is four
lines of JSON you can read yourself.

### 2. The content script that reads your pages has no network primitive in it

```sh
grep -c "XMLHttpRequest\|sendBeacon\|WebSocket\|EventSource" \
  packages/extension/.output/chrome-mv3/content-scripts/content.js   # 0
```

The word `fetch` does appear: the embedded rate table records a `fetched_at`
provenance field on every row. The **call** does not, which is what the next
check establishes behaviourally rather than by grep.

### 3. Drive the built artifact and watch it do nothing

```sh
pnpm --filter @disclosed/extension verify-built
```

This loads the **shipped** content script — rolled up, tree-shaken, minified —
into a page containing real affiliate link shapes and two cloaked links, lets it
run, and reports: every anchor byte-identical before and after, markers actually
inserted so the check is not vacuous, `fetch` / `XMLHttpRequest` /
`sendBeacon` / the message channel to the background worker all called zero
times, and one cloaked link answered **from the table inside the artifact**.

That last line matters. Without it, "zero requests" would be the weaker claim
*it asked nobody because it had nothing to ask.*

### 4. Run the tests

```sh
pnpm --filter @disclosed/core test         # the classifier
pnpm --filter @disclosed/extension test    # the extension, jsdom
```

Among them: `hrefs-untouched` captures every anchor's markup, attributes and
resolved destination before the scan and asserts they are identical after;
`no-network` drives the real content script over every cloaked URL in the
corpus, **in a build configured with an API base**, with every network primitive
spied, and asserts every count is zero.

---

## What it never sends

- **Never a URL you visited**, to us or to anyone.
- **Never the page's content, title, text or links.**
- **Never an identifier.** No account, no email, no user id, no install id, no
  device id, no cookie.
- **Never analytics, telemetry, error reporting or usage counts.**
- **Never a request to a merchant, an affiliate network or a redirector.** It
  does not follow, prefetch, resolve or fire an outbound link.

Nothing is written to `localStorage`, `chrome.storage`, IndexedDB or a cookie.
It keeps no record of anything you looked at, including in memory once the tab
is closed.

## What it never does to the page

It does not strip, replace, inject, rewrite, redirect or fire an affiliate link.
Not as a feature, not as an option, not behind a flag. It inserts a dot *beside*
a link, in the link's parent, after it.

Extensions that overwrite a creator's affiliate tag with their own take a
commission somebody else earned. That practice is one of the things this project
exists to document, and an extension that did it while claiming to expose it
would have nothing left to say.

## What gets marked, and what never does

| Tier | Marked |
|---|---|
| Verified signature match | Yes, filled dot |
| Unverified signature, a resolved redirect, or the publisher's own `rel="sponsored"` on its own domain | Yes, hollow dot |
| A bare `?ref=` / `?aff=`, or `rel="sponsored"` pointing at another company's domain | **Never** |
| No signal | No |

A bare tracking parameter is never marked under any circumstance. Those
parameters are used constantly for things that pay nobody. One wrong mark costs
more than a hundred missed links.

---

## About this repository

**It is generated.** This is a subtree split of the private monorepo where the
crawler, the corpus and the scoring live, produced by `ops/split-extension.mjs`
there and pushed here. `SPLIT.json` records the source commit and a hash over
every file, and a test in the monorepo fails if this repository's head stops
matching. Send issues and pull requests here; changes are applied upstream and
flow back through the split.

### The publisher cards are withheld from the bundle in this copy

`data/bundle/rules-latest.json` here carries `"cards": []`. The 22 cards
summarise measurements about named publishers, and the method gives every
publisher seven days' written notice before anything about it is published — a
public repository being publication like any other. the launch gate refuses (17 blocker(s)): at least one publisher's seven-day right-of-reply window has not run, or nobody has recorded what came back.

The bundle is otherwise identical and its `sha256` has been recomputed over the
reduced body, so it still verifies against itself. Every site will report "no
report card" in the popup, which is accurate: none has been published. The cards
appear here in the same commit they appear on the website.

### One test is not in this repository

`packages/extension/test/hard-rules-e2e.test.ts` drives the API worker, which
lives in the private monorepo alongside the crawler and the corpus. It is
excluded rather than stubbed or skipped.

Nothing about the guarantee is weakened by its absence. The extension-side
assertions it makes are also made here by `test/hrefs-untouched.test.ts` (every
anchor byte-identical), `test/no-network.test.ts` (the real content script over
every cloaked URL with every network primitive spied) and `verify-built` (both,
against the shipped artifact rather than the source).

## Licence

MIT. See `packages/extension/LICENSE`.

An unauditable privacy claim is worth nothing, which is the entire reason this
repository exists.

*The commit this was split from is in `SPLIT.json`, not here. It used to be
printed in this line, which made the README — and therefore the `splitId` — change
on **every** commit to the source repository, including commits that touched
nothing in this one. The drift test then failed constantly for the one reason that
is not drift, which is how a sync check gets switched off.*
