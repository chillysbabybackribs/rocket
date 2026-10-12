# Browser overlays without page disruption

Rocket should keep the active browser page attached, visible, and at unchanged bounds while displaying app overlays in native views above it. Electron exposes the necessary stacking and transparency APIs. Rocket already uses separate views for address suggestions and the Fill with Rocket chip; the missing piece is a shared overlay system for the rest of the interface.

This is an implementation design based on the current source and official documentation, checked on 11 October 2026. The installed Electron package is 44.5.1. Runtime overlay behavior has not been changed or validated by this research.

## Confirmed causes in Rocket

| Location | Current behavior | Required change |
| --- | --- | --- |
| `src/renderer/src/components/BrowserPanel.tsx:219` | Image previews trigger `setBounds(null)`; the effect also sends null bounds during cleanup when preview state changes. | Decouple page geometry from overlay state. |
| `src/main/browser-pane.ts:344` | Null bounds pause hands-free reading, hide suggestions, and conceal the page. | Reserve this path for actually closing or hiding the browser panel. |
| `src/renderer/src/components/Capture.tsx:131` | Capture dialogs use the same preview flag to hide the page. | Render these dialogs in the modal overlay surface. |
| `src/renderer/src/components/TitleStrip.tsx` and `AttachmentMenu.tsx` | Flyouts and menus are constrained to the chat area. | Position against the window after migration to native overlays. |
| `src/main/browser-suggest.ts` and `page-fill.ts` | Each manages its own native overlay and ordering. | Coordinate through one native layer controller. |
| `src/main/browser-url.ts:77` | Comment says a native view cannot be covered. | Correct this: another native view can cover it. |

The main shell's CSS stacking order cannot reorder a sibling native browser view. Raising a CSS z-index, moving a React portal to the shell body, or using a shell HTML dialog therefore does not solve this architecture.

## Documented mechanism

Electron's `WebContentsView` inherits from `View`. Its parent controls native stacking: adding an existing child again raises it to the top. Bounds are relative to the parent. Rocket can retain its existing BrowserWindow and add overlay siblings to its content view. A BaseWindow migration is not required for this design. See [WebContentsView](https://www.electronjs.org/docs/latest/api/web-contents-view) and [View](https://www.electronjs.org/docs/latest/api/view).

Set the overlay's native background to `#00000000` before loading it, and keep its HTML and body transparent. Electron explicitly documents that WebContentsView otherwise starts with a white background. This prevents that default white backing from becoming an overlay flash. See [Electron's migration guide](https://www.electronjs.org/blog/migrate-to-webcontentsview).

Chromium separates painting from composition and can combine existing content with other layers. Keeping the page's surface stable is the architectural basis for the proposed fix; the documentation does not promise that every Linux compositor will produce flawless transitions without testing. See [Chromium compositing architecture](https://www.chromium.org/developers/design-documents/gpu-accelerated-compositing-in-chrome/).

## Implementation

1. Add a main-process overlay controller that owns reusable app-only WebContentsViews, their ordering, bounds, focus, and lifecycle. Keep browser tabs below app popovers and modals. Reassert overlay order after tab creation or activation without detaching or hiding the active page.
2. Add an overlay renderer entry and a narrow typed preload/IPC contract. The shell sends overlay type, ID, anchor, and serializable display data; the overlay sends typed actions back. Keep chat and provider state in their existing owners. Validate senders and reject stale actions after dismissal. Remote pages must not receive this app bridge.
3. Use bounded native views for nonmodal menus, tooltips, and flyouts. Use a full-window transparent view with a deliberate backdrop for modal image previews and capture dialogs. Transparency is a painting property, not a promise of native click-through; avoid a permanent full-window transparent layer over an interactive page.
4. Preload and reuse the overlay renderer. Send a generation-tagged model, wait for layout/readiness, and then present the overlay at its measured bounds. Handle image loading within the overlay. Cancel stale readiness messages when the user closes or replaces it. A DOM-ready event or animation-frame callback alone is not proof that the screen has presented a frame; verify initial presentation in the compositor tests.
5. Implement focus and dismissal across web contents. Hover tooltips should not take focus. Menus need arrow keys and Escape; modals need focus containment and restoration. Observe outside interaction in both shell and browser, since shell document listeners cannot see browser-view clicks. Do not synthesize a second click into the page.
6. Move image previews and capture dialogs first, then remove their browser-hiding flag. Migrate usage flyouts, attachment menus, and any other popup that can cross the browser region. Reuse the controller for suggestions and fill chips. Remove chat-only positioning constraints only after each overlay is migrated.
7. Use one coordinate convention in main: window-content device-independent pixels. Convert shell or page CSS anchors with the owning web contents' zoom and native view offset exactly once. Recompute or dismiss on genuine window/anchor changes. Never move the browser page to make room for an overlay.

Add the renderer entry in `electron.vite.config.ts`, shared messages in `src/shared/`, and lifecycle integration in `src/main/index.ts`. Update the README and comments that currently describe avoiding overlap as a permanent restriction.

## Page continuity requirements

Opening, changing, or closing an overlay must not call hide, conceal, detach, reload, navigate, resize, or parking operations on the active page. Do not replace it with a screenshot. Preserve its webContents identity, viewport, scroll, forms, selection, media playback, and hands-free reading state. Intentional keyboard focus changes for interactive overlays are expected; restoring focus must not reload or reset the page.

Keep page visibility and animation continuity in the tests. Electron documents that background throttling affects timers, animation, and visibility behavior. Do not disable throttling globally as a substitute for fixing the hiding path; evaluate a targeted policy only if compositor tests expose an actual remaining issue. See [WebPreferences](https://www.electronjs.org/docs/latest/api/structures/web-preferences).

## The displaced website dropdown

The supplied screenshot shows a categories popup displaced left of its website control and partly overlapping the chat. It is consistent with a native select popup using the wrong coordinate origin, but the screenshot alone does not prove the cause. This is separate from shell overlays being obscured. Chromium's historical architecture documentation specifically describes select popups as native widgets; its implementation details are older than the installed runtime. See [How Chromium displays pages](https://www.chromium.org/developers/design-documents/displaying-a-web-page-in-chrome/).

Reproduce with a minimal HTML select inside a WebContentsView at a nonzero offset, on the installed Electron version. Compare zero offset, moved window, resizing, page zoom, display scale, and X11 versus Wayland. If it reproduces outside Rocket, verify an upstream Electron fix or prepare a minimal upstream patch/reproducer. If it reproduces only in Rocket, trace native bounds and transforms. Do not claim the overlay controller fixes it, inject replacement dropdowns into arbitrary websites, or compensate by moving the page.

## Acceptance tests

Use a controlled page with a persistent document ID, scroll position, populated form, selection, animated frame counter, visibility and resize event logs, and playing media. Repeatedly open, update, and close every overlay while the page is active, including rapid replacement and closing during initial load.

Assert unchanged page identity, URL, history, viewport, scroll, and form values; no overlay-induced hide, resize, navigation, reading pause, or media pause; correct keyboard dismissal and focus restoration; working clicks and scrolling outside bounded popovers; and correct ordering after tab creation and window resizing.

Record the actual composed window at display frame rate and inspect opening and closing transitions for blank, white, black, or stale replacement frames. Separate shell and page screenshots cannot establish stacking or rule out flashing. Rocket's snapshot code already warns about this limitation when whole-window capture is unavailable. Test on the user's actual Linux compositor as well as the isolated test display, including fractional scaling where available.

Ship only when the visual recording and lifecycle assertions both pass. The first implementation milestone is the reusable native overlay controller plus image preview and capture migration, followed by popup migration and the independent native-select investigation.
