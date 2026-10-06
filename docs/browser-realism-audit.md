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

A real Chrome 152 on Linux always sends, on every request:

```
Sec-CH-UA: "Chromium";v="152", "Google Chrome";v="152", "Not?A_Brand";v="99"
Sec-CH-UA-Mobile: ?0
Sec-CH-UA-Platform: "Linux"
```

And in the page, `navigator.userAgentData` is a populated object. Here it is `null`.

**Cause.** `src/main/browser-pane.ts` sets a cleaned user-agent string:

```ts
pages.setUserAgent(plainUserAgent(pages.getUserAgent(), app.name), ACCEPT_LANGUAGES)
```

`plainUserAgent` strips the `Rocket/…` and `Electron/…` tokens so the UA string reads as plain
Chrome. That part is correct and worth keeping. The problem is that Chromium's
`setUserAgent()` overrides **only the UA string** and leaves the UA-Client-Hints metadata
(`userAgentMetadata`) empty. So the browser advertises "Chrome/152" in the UA but emits no client
hints and exposes no `navigator.userAgentData`. A UA that claims Chrome while sending no client
hints is a trivially-detectable inconsistency, and modern Cloudflare (and most managed challenges)
key on exactly this.

**Fix.** Set the UA string and its client-hint metadata together, so they agree. Chromium only
exposes this through CDP `Network.setUserAgentOverride` with a `userAgentMetadata` object; the
session-level `setUserAgent` has no metadata parameter. The app already drives tabs over the
DevTools protocol (`src/main/browser-agent.ts`), so the plumbing exists. Per tab, after the view is
created:

```ts
await contents.debugger.sendCommand('Network.setUserAgentOverride', {
  userAgent: plainUserAgent(session.getUserAgent(), app.name),
  acceptLanguage: ACCEPT_LANGUAGES,
  userAgentMetadata: {
    brands: [
      { brand: 'Chromium', version: major },
      { brand: 'Google Chrome', version: major },
      { brand: 'Not?A_Brand', version: '99' }
    ],
    fullVersionList: [
      { brand: 'Chromium', version: full },
      { brand: 'Google Chrome', version: full },
      { brand: 'Not?A_Brand', version: '99.0.0.0' }
    ],
    platform: 'Linux', platformVersion: '6.0.0',
    architecture: 'x86', bitness: '64',
    model: '', mobile: false, wow64: false
  }
})
```

`major`/`full` must be **derived from the real Chrome version in the UA string** (not hardcoded),
so they stay true across Electron upgrades — the same discipline `plainUserAgent` already follows.
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

1. **Client hints via CDP `setUserAgentOverride`** — the only change likely to clear the Cloudflare
   challenge. Do this first and re-test `openai.com`.
2. `window.chrome` shim — if realism still falls short after (1).
3. Normalize `navigator.languages`; check the notification-permission desync.

All of these are main-process changes, so they need Rocket restarted to take effect, and should be
verified by re-running this fingerprint plus a header echo after each step.
