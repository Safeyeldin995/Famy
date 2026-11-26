# App Review notes (App Store Connect → App Review Information → Notes)

Paste the text below into the Notes field for every iOS submission.

---

Famy is a marketplace in Egypt that connects families with independent service providers (babysitting, home tutoring, elderly care, and live online lessons).

**Payments (guideline 3.1.3(d) and 3.1.3(e))**
- In-person services are physical services consumed outside the app, so they are paid by card through Paymob (Apple Pay is offered through Paymob where available), not with in-app purchase.
- Online lessons are live, real-time, one-to-one video sessions between one student and one human teacher, booked and priced per session. This is a person-to-person real-time service under 3.1.3(d). Sessions are not recorded, and the app sells no pre-recorded or on-demand content.
- Refunds for cancelled lessons stay as Famy wallet credit for future bookings; no digital goods are unlocked with it.

**Camera and microphone**
Used only inside a live online lesson so the student and teacher can see and hear each other. Nothing is recorded or stored.

**Sign-in**
- **Existing accounts:** phone number **and password** (not SMS OTP at login). OTP is only for new sign-up and password reset.
- **Sign in with Apple** is offered on iOS when any third-party sign-in is offered.

**Account deletion**
Profile → Delete account (customers) and Pro profile → Delete account (providers). The web page is https://famy-chi.vercel.app/account/delete

**User-generated content (chat and reviews)**
Booking chat includes in-thread actions to report a message or conversation and to block the other party; public provider reviews can be reported from the provider profile. Reports go to Famy admin for review. Blocking hides the conversation and prevents new messages and new bookings between the two users.

**Demo accounts (fill in Play Console / ASC only — do not commit real credentials)**
- **Customer:** phone + password for a customer with at least one active or recent booking; set the service address pin inside a served zone when booking.
- **Provider:** phone + password for an approved provider with online tutoring enabled and at least one booking to show.
- Never put real users' numbers or passwords in this repository.

**Staged rollout**
See [../docs/store/staged-rollout.md](../docs/store/staged-rollout.md) if a phased release is planned.
