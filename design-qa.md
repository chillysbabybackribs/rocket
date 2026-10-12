# Orbit header icons

final result: passed

Source visual truth: `docs/mockups/header-icons/02-orbit.png` (1536 × 1024 concept sheet).
Implementation screenshot: `docs/mockups/header-icons/implemented-shell.png` (1360 × 860, CSS viewport 1360 × 860, density 1).
Combined comparison: `docs/mockups/header-icons/implemented-comparison.png`.

Compared the actual header at native size and 3× enlargement against the concept's header detail. The concept is an enlarged presentation, not a literal window viewport; its header detail is normalized to a comparable width. Browser is selected in the implementation. The test screenshot also hovers Antigravity, showing its existing flyout; fixture readings are all 25%, unlike the concept's illustrative readings. Existing notch geometry and usage typography are intentionally preserved.

## Findings

No actionable P0/P1/P2 differences found in the first comparison.

- Typography: existing Inter percentages and tooltips retained; visible Library/Browser text replaced by images, accessible names retained.
- Layout: 36 × 32 button targets, centered 28px image boxes with approximately 26px visible artwork, aligned with the existing 26px meters. Existing notch spacing and flares retained.
- Colors: silver outlines and indigo edges match Orbit. Inactive artwork is subdued; selection uses the existing selected surface token. Usage colors retain their original meaning.
- Assets: transparent generated PNGs reproduce dimensional book spines and orbital globe. No background rectangles or clipped artwork at actual size. High-resolution assets support high-density displays. Globe details are naturally finer at 26px than the enlarged concept.
- Content: unchanged panel destinations, dynamic accessible names, pressed states and tooltips. No concept-sheet labels leak into the app.

## Validation

Build/typecheck and 266 unit tests passed. Isolated titlebar test passed, including Browser opening, center alignment, all four meters, and flyout placement. Test fixture records renderer errors. Native button keyboard behavior and focus outlines remain; hover/focus transforms are suppressed by the reduced-motion media query (code inspected).

## Implementation checklist

- [x] Add selected Orbit assets.
- [x] Replace labels while retaining button semantics.
- [x] Add hover/focus motion and reduced-motion handling.
- [x] Inspect rendered header and combined visual comparison.

## Follow-up polish

No blocking follow-up. Keyboard focus animation and reduced-motion behavior have been reviewed in code but not independently exercised in a dedicated UI scenario. Current user window still uses the previously loaded build; restart is required to display the new header there.
