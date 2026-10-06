# Embedded browser realism audit

**Date:** 2026-10-06 · **Electron:** 44.5.1 · **Chromium:** 152.0.7977.130
**Method:** in-page fingerprint (`navigator`, WebGL, codecs, permissions) plus a live header echo
(`httpbin.org/headers`) from the `persist:browser` session, compared against stock desktop Chrome.

## Verdict

The embedded browser is **mostly indistinguishable from stock Chrome**, with one critical
exception: it sends **no User-Agent Client Hints**. That single gap is the most likely reason
`openai.com` serves its Cloudflare "Just a moment…" challenge while `chatgpt.com` loads normally.
Everything a cheaper bot check looks at (webdriver flag, software rendering, missing codecs, empty
plugins) is already clean.

## Critical

### 1. No User-Agent Client Hints (`Sec-CH-UA*` absent, `navigator.userAgentData` is null)

The outgoing navigation headers, captured live:

```
User-Agent: Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.7977.130 Safari/537.36
Accept-Language: en-US,en;q=0.9
Sec-Fetch-Dest: document      Sec-Fetch-Mode: navigate      Sec-Fetch-Site: none
(no Sec-CH-UA, no Sec-CH-UA-Mobile, no Sec-CH-UA-Platform)
```

A real Chrome 152 on Linux always sends, on every request (brand text, GREASE version and order
all follow from the major version, per Chromium's `user_agent_utils.cc`):

```
Sec-CH-UA: "Chromium";v="152", "Not?A_Brand";v="24", "Google Chrome";v="152"
Sec-CH-UA-Mobile: ?0
Sec-CH-UA-Platform: "Linux"
```

And in the page, `navigator.userAgentData.brands` lists Chrome's three brands. Here it lists two,
Chromium's own default (`Not?A_Brand`, `Chromium`), with no `Google Chrome`. (An earlier reading of
`null` was taken on `about:blank`, which is not a secure context; on a real page the object exists.)
So three things disagree: the UA string says Chrome, the page API says plain Chromium, and the
headers say nothing at all.

**Cause.** `src/main/browser-pane.ts` sets a cleaned user-agent string:

```ts
pages.setUserAgent(plainUserAgent(pages.getUserAgent(), app.name), ACCEPT_LANGUAGES)
```

`plainUserAgent` strips the `Rocket/…` and `Electron/…` tokens so the UA string reads as plain
Chrome. That part is correct and worth keeping. The missing headers have a different cause,
verified in Electron's source: `ElectronBrowserContext::GetClientHintsControllerDelegate()` returns
`nullptr` (branch `44-x-y`), and Chromium only adds `Sec-CH-UA*` headers through that delegate. So
no Electron app sends client hints, whatever `setUserAgent` or the metadata says. Meanwhile the
page-side `navigator.userAgentData` is filled from Chromium's build metadata, which for a
Chromium-branded build is the two-brand list. A UA that claims Chrome while sending no client hints
is a trivially-detectable inconsistency, and modern Cloudflare (and most managed challenges) key on
exactly this.

**Fix (implemented).** Make the UA string, the page API and the headers agree, from one piece of
metadata. Two layers are needed, because the DevTools protocol fixes only the page side: tested
live, `Network.setUserAgentOverride` with `userAgentMetadata` changes `navigator.userAgentData` to
the Chrome brand list (and holds across a cross-site navigation), but with no delegate Chromium
still emits no headers. So:

```ts
// 1. Page side, per tab as it is made (browser-pane.ts, presentAsChrome). The debugger stays
//    attached; opening DevTools detaches it and the override is put back when they close.
await contents.debugger.sendCommand('Network.setUserAgentOverride', {
  userAgent,                                   // the session's plain Chrome UA, unchanged
  userAgentMetadata: userAgentMetadata(userAgent)   // browser-url.ts
})
// 2. Header side, once per session (browser-pane.ts, sendClientHints): webRequest adds
//    clientHintHeaders(metadata, hintsAskedFor(origin)) to every HTTPS request, where the
//    high-entropy set per origin is learned from Accept-CH response headers.
```

Verified by echo: the server then receives `Sec-CH-UA`, `Sec-CH-UA-Mobile` and `Sec-CH-UA-Platform`
on both the navigation and a subresource `fetch`. Not emulated: a `Critical-CH` restart, so an
origin that insists on high-entropy hints gets them from its second request on.

`userAgentMetadata()` builds the metadata **from the real Chrome version in the UA string**, with
Chrome's own algorithm for the GREASE brand and the brand order (both seeded by the major
version), so it stays true across Electron upgrades — the same discipline `plainUserAgent` already
follows. Two details verified against Chromium source rather than assumed: on Linux Chrome's
`platformVersion` is the **empty string** (not a kernel version), and for Chrome 152 the GREASE
brand is `Not?A_Brand` v**24**, placed second.
Note CDP overrides are per-WebContents and must be applied to each tab (and re-applied after a
cross-process navigation), unlike the one-shot session call today.

## Moderate

### 2. `window.chrome` is an empty object

`window.chrome` exists but has no keys: no `runtime`, `loadTimes`, `csi`, or `app`. Stock Chrome
populates these. A few detectors probe `window.chrome.runtime` / `window.chrome.csi`. This is
harder to fake faithfully and a weaker signal than the client hints, so it is second priority. If
hardened, inject a minimal shim (a `chrome.csi`/`chrome.loadTimes` stub and a `runtime` object) in
a preload for browser tabs — but only after the client-hints fix, which is the one that matters.

## Minor

### 3. `navigator.languages` has a duplicate

`navigator.languages` is `["en-US", "en", "en"]` while the `Accept-Language` header is the correct
`en-US,en;q=0.9`. The header is fine; the in-page array has a stray repeated `"en"`. Cosmetic, but
a careful fingerprint would notice the two disagree.

### 4. Notification permission inconsistency

`Notification.permission` is `"denied"` while `navigator.permissions.query({name:'notifications'})`
reports `"granted"`. These normally agree. Worth confirming nothing in the app forces a permission
result that desyncs them.

## Healthy — no action needed

| Signal | Value | Note |
|---|---|---|
| `navigator.webdriver` | `false` | correct |
| WebGL renderer | ANGLE / NVIDIA GTX 1050 | real GPU, not SwiftShader/llvmpipe |
| Proprietary codecs | H.264, AAC, MP3 all "probably" | present; a common Electron gap this build does *not* have |
| `navigator.plugins` | 5 PDF entries | matches real Chrome |
| `pdfViewerEnabled` | `true` | correct |
| `hardwareConcurrency` / `deviceMemory` | 8 / present | plausible |
| AudioContext sample rate | 48000 | normal |
| Patched natives | none | `webdriver` getter and `permissions.query` report native code |
| Screen / window geometry | 2560×1080, non-zero outer size | not headless |

## Recommended order

1. **Client hints** (done): CDP `setUserAgentOverride` for the page API plus `webRequest` header
   injection, both from `userAgentMetadata`. The one change likely to clear the Cloudflare
   challenge; re-test `openai.com` after a restart.
2. `window.chrome` shim — if realism still falls short after (1).
3. Normalize `navigator.languages`; check the notification-permission desync.

All of these are main-process changes, so they need Rocket restarted to take effect, and should be
verified by re-running this fingerprint plus a header echo after each step.
