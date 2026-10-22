# Arabic accessibility and RTL screenshots

Captured by the local `*-web.cjs` QA harnesses at 390 × 844, with Arabic selected and deterministic preview fixtures. The before images were captured from `c9fc4e2`. The after images were refreshed from the final PR branch with the Product Owner's approved `#F10E72` brand fill and the separate `#D40C60` text token.

| Screen                 | Before                                  | After                                 |
| ---------------------- | --------------------------------------- | ------------------------------------- |
| Customer home          | [before](before/home.png)               | [after](after/home.png)               |
| Customer bookings      | [before](before/bookings.png)           | [after](after/bookings.png)           |
| Booking review/payment | [before](before/booking-review.png)     | [after](after/booking-review.png)     |
| Provider dashboard     | [before](before/provider-dashboard.png) | [after](after/provider-dashboard.png) |

The changes focus on screen-reader semantics, touch area, tab-label room at large font scales, directional layout, and contrast. Some improvements (labels and hit areas) are not visible in screenshots. `qa/a11y-rtl.cjs` checks the in-scope controls, the approved brand token, text contrast, and 1–3× tab-height calculations.

White text on `#F10E72` has a 4.16:1 contrast ratio. The primary button label is heavy 22px, so it passes the 3:1 large-text threshold. Smaller white labels in the provider dashboard and earnings hero, and the outgoing chat bubble body/time, remain below the 4.5:1 normal-text threshold. On iOS, the small stack back title also inherits the pink icon tint and remains below 4.5:1 on the light header; see the PR description.
