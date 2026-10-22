# Arabic accessibility and RTL screenshots

Captured by the local `*-web.cjs` QA harnesses at 390 × 844, with Arabic selected and deterministic preview fixtures. The before images were captured from `c9fc4e2`; the after images were captured from this branch after syncing with `a9b9aba` on `main`.

| Screen | Before | After |
| --- | --- | --- |
| Customer home | [before](before/home.png) | [after](after/home.png) |
| Customer bookings | [before](before/bookings.png) | [after](after/bookings.png) |
| Booking review/payment | [before](before/booking-review.png) | [after](after/booking-review.png) |
| Provider dashboard | [before](before/provider-dashboard.png) | [after](after/provider-dashboard.png) |

The changes focus on screen-reader semantics, touch area, tab-label room at large font scales, directional layout, and contrast. Some improvements (labels and hit areas) are not visible in screenshots. `qa/a11y-rtl.cjs` checks the in-scope controls and 1–3× tab-height calculations.
