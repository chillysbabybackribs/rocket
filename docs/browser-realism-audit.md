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

### 2. `window.chrome` is an empty object (fixed)

`window.chrome` existed but had no keys. The installed Chrome 152, probed headless with a scratch
profile, has exactly three on an ordinary page: `loadTimes`, `csi` and `app` (no `runtime` without
an extension that talks to the page), all enumerable, writable and configurable. The public
detector at bot.sannysoft.com flagged this as its one failure (`HEADCHR_IFRAME`), everything else
passing. `src/main/chrome-object.ts` fills the object to that shape, with the value semantics from
`chrome/renderer/loadtimes_bindings.cc`, at document start in every frame via
`Page.addScriptToEvaluateOnNewDocument` on the per-tab debugger session. Verified: present on a
tab's first page and in frames the page creates.

**Residual:** the fill is a script where Chrome's is native, so a page that inserts an iframe and
reads `contentWindow.chrome` *synchronously in the same tick* still sees `{}`; the sannysoft
`HEADCHR_IFRAME` row does exactly that and still fails. Closing it would mean intercepting iframe
creation in page JavaScript, which is deep spoofing territory and was not done.

## Minor

### 3. `navigator.languages` has a duplicate (fixed)

`navigator.languages` read `["en-US", "en", "en"]` whatever accept-languages the session was given,
even none: it is how Electron derives the list. Passing `acceptLanguage` in the protocol's user-agent
override sets it to Chrome's `["en-US", "en"]` while leaving the `Accept-Language` header, which
already read as Chrome's `en-US,en;q=0.9`, untouched. (Passing a q-value there corrupts both; the
plain list is the right input.)

### 4. Notification permission (left as is)

Chrome shows a fresh site `Notification.permission === "default"`. Electron's permission handlers
answer yes or no only (`setPermissionCheckHandler`, `setPermissionRequestHandler`), so a page here
sees `"granted"` with no handler or `"denied"` with one; "default" is unreachable. "Granted" is the
state Chrome shows for sites a user allowed and is the lesser tell, so it stays. The earlier reading
of `"denied"` beside a `"granted"` query was taken on `about:blank`.

### 5. Window geometry (left as is)

`outerWidth` is the whole app window (2560) while `innerWidth` is the page region (1307). Chrome's
differ by a few pixels. The gap is real: the page shares the window with the chat, like a browser
with a wide side panel open. Faking it would be a lie about layout; not done.

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
2. `window.chrome` fill (done) and `navigator.languages` (done), both on the same debugger session.
3. Left as is, with reasons above: notification permission state, window geometry, and the
   synchronous first-tick read of a new iframe's `chrome`.

**Live result after (1):** openai.com moved from a silent block to Cloudflare's interactive
"Verify you are human" checkbox, which then looped on a human click while the user's own Chrome
passes. (2) addresses the one detector-confirmed tell remaining at that point; re-test after a
restart, in a fresh tab of the user's own with DevTools closed, since a tab a model has driven is
instrumented beyond the baseline and open DevTools switch the page-side override off.

All of these are main-process changes, so they need Rocket restarted to take effect, and should be
verified by re-running this fingerprint plus a header echo after each step.
