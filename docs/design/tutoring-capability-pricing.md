# Tutoring: approved teaching capability pricing

Issue #92. Draft migration only — do not apply to QA or Production.

Babysitting pricing is unchanged. Commission (#91) is out of scope.

## Rules

1. **Price source.** For tutoring, the only price source is an approved teaching capability. Never use `providers.hourly_rate` or `provider_services.price_override`.
2. **Fixed session.** Each capability has one `session_duration_min` and one `session_price` (whole EGP). Subtotal is that price, not price × hours.
3. **Durations.** Allowed values: 60, 90, 120, 180 minutes. Default is 120. 180 is allowed only when the subject’s `max_session_duration_min = 180`. The server enforces `session_duration_min ∈ allowed set AND ≤ subject.max_session_duration_min` on capability upsert and on every booking.
4. **Price.** Whole EGP only, within the service `minimum_price` / `maximum_price` (launch tutoring services: 300–1500). Re-checked on every booking. No bypass.
5. **Approval.** Provider proposes; admin approves or rejects. Any change to duration, price, subject, curriculum, or level after approval returns the row to `pending`. Nobody approves their own capability.
6. **Booking snapshot.** Each booking stores capability id, subject/curriculum/level codes and names, duration, and price. These never change after insert.
7. **Server eligibility.** `create_booking` / `tg_validate_booking_service` reject with `BOOKING_PROVIDER_INELIGIBLE` (23514) unless the capability exists, belongs to the provider, matches the service, is `approved`, matches the requested subject/curriculum/level, the subject is linked to the service, subject/curriculum/level are still active, `end_at − start_at = session_duration_min`, duration is still allowed and within the subject cap, and price is within current service min/max. Applies to new bookings, direct URLs, and Book Again.
8. **Student.** Tutoring may be for myself or an owned active family member. Curriculum/level come from the request (education-profile prefills are a later issue).
9. **Taxonomy.** Admin-managed codes with `name_ar` / `name_en`, `is_active`, `sort_order`. Public reads active rows. Launch seed is idempotent `ON CONFLICT (code) DO NOTHING`.

## Launch taxonomy

**Curricula:** `eg_national_ar`, `eg_national_lang`, `british`, `american`, `ib`, `french`, `german`.

**Levels (sort order):** `kg`, `g1`–`g12`. Grade-based across curricula. British IGCSE/AS/A Level maps to g10–g12 as hint text only.

**Subjects** (service links + max minutes):

| code | services | max |
|---|---|---|
| `homework_all` | homework-support | 120 |
| `math`, `physics`, `chemistry`, `biology` | school-subject-tutoring | 180 |
| `science`, `social_studies`, `history`, `geography`, `computer`, `philosophy`, `psychology` | school-subject-tutoring | 120 |
| `arabic`, `english`, `french`, `german` | school-subject-tutoring, language-tutoring | 120 |

Missing service slugs are skipped; the seed never fails.

## Data model

- `teaching_curricula`, `teaching_levels`, `teaching_subjects` (`max_session_duration_min` CHECK IN (60,90,120,180), default 120), `teaching_subject_services(subject_id, service_id)`.
- `provider_teaching_capabilities`: unique `(provider_id, service_id, subject_id, curriculum_id, level_id)`; `session_duration_min`; `session_price integer`; `status` `pending|approved|rejected|suspended`; `submitted_at`; `reviewed_by`; `reviewed_at`; `review_note` (admin-only, never returned to customers).
- `services.allowed_session_durations int[]` — `{60,90,120,180}` for the three tutoring slugs only.
- Bookings (nullable snapshot): `teaching_capability_id`; subject/curriculum/level codes and names; `session_duration_min`. Added to the immutable-price guard.

## RPCs

All SECURITY DEFINER with `search_path = public`. No direct writes on capabilities.

| Function | Who | Behavior |
|---|---|---|
| `provider_upsert_teaching_capability` | owning provider | Validates subject↔service, duration (allowed set + subject cap), price (min/max). Always sets `pending`. |
| `provider_remove_teaching_capability` | owning provider | Deletes own row. Existing booking snapshots are unchanged. |
| `admin_review_teaching_capability` | admin, not the provider owner | Approve / reject / suspend with optional `review_note`. |
| `admin_list_provider_teaching_capabilities` | admin | Returns rows including `review_note`. |

## Error codes

| Code | When |
|---|---|
| `BOOKING_PROVIDER_INELIGIBLE` (23514) | Tutoring booking fails rule 7 (unapproved, wrong owner, service/subject/duration/price mismatch, inactive taxonomy, suspended, Book Again of a non-approved capability). |
| `TEACHING_UNAUTHORIZED` (42501) | Caller is not the owning provider or not an admin. |
| `TEACHING_INVALID_DURATION` (23514) | Duration not in the allowed set, or above the subject cap. |
| `TEACHING_INVALID_PRICE` (23514) | Price not whole EGP or outside service min/max. |
| `TEACHING_SUBJECT_NOT_LINKED` (23514) | Subject is not linked to the service, or subject/curriculum/level is inactive. |
| `TEACHING_SELF_REVIEW` (42501) | Admin owns the provider and attempted to review it. |

Customer-facing reads never return `review_note`, ID documents, or reference phones.
