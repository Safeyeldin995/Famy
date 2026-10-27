# Customer parity 5 booking gate — failed, no retry

Base `e974a84`, branch `codex/mobile-web-parity-5`, 2026-10-27.

Command: `node qa/phase2a-web.cjs dist-parity-5 qa/parity-evidence/native/parity-5/final/phase2a-web`.

The first run reached hourly, fixed-package and tutoring bookings, then failed because the old address locator expected a GPS-only control. The one focused correction follows the intentional web-style map picker: request location, confirm the draft pin, save, then assert latitude/longitude in the mocked address write. Assertions were not removed.

The corrected run exited **1** before reaching that address step:

```text
page.reload: Page crashed
waiting for navigation until "load"
navigated to the local /booking/<synthetic-id>?created=1&educationWarning=0 route
```

The crash listener recorded `{"event":"page.crash","step":"booking flow","appErrors":[]}`. This identifies the browser crash event, not proof that every application path is correct.

[Last successful frame before the receipt reload](parity-5-booking-before-crash.png). **This is not a screenshot of the crash**; Chromium could not capture a page after it crashed. The snapshot is synthetic local QA data only.

No retry or reload workaround was attempted. Later screenshots left by the earlier run are not evidence that the corrected run completed. Tutoring, address pin/save, inline form saves, and later assertions are not claimed passed by the final run. Preserve this failure for the next explicitly approved bounded closure.
