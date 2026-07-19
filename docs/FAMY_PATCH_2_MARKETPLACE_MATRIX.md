# Famy Patch 2 — Identity and Provider Marketplace Matrix

Verified 2026-07-19 against the local runtime and Vercel Preview deployment
`dpl_2GJChbHqnHA1bMBzC6fD2qXfPMWH` using the real Supabase project
`mjhkaiabfnzewprcnojp`. The complete relevant suite passed 43/43 on both targets.

## Identity separation

| Control | Authoritative implementation | Browser/database proof | Local | Preview |
|---|---|---|---|---|
| Signup role | `handle_new_user` accepts only the `signup_role` metadata value and creates one normal role | Customer and Provider QA accounts have exactly one expected role | PASS | PASS |
| Conflicting role assignment | `enforce_normal_role_exclusivity` rejects Customer+Provider; Admin may coexist with one normal role | Customer Provider-role insert and Provider-profile creation both fail; rows remain unchanged | PASS | PASS |
| Provider onboarding | `create_provider_profile` requires an existing Provider role and creates no Customer role | Customer RPC call fails with `42501` and no Provider row | PASS | PASS |
| Admin directories | `admin_customer_identity_ids` and `admin_provider_identity_ids` are role-authoritative | Exact QA Customer appears only in Customers; exact QA Provider only in Providers; refresh PASS | PASS | PASS |
| Preserved conflicts | `admin_identity_conflicts` reports orphan Provider records and invalid Admin combinations without deleting history | Admin Providers exposes issue code, details, and retained Provider navigation | PASS | PASS |

No ambiguous real-user role or business record is deleted. Existing Provider records
without a Provider role are excluded from both normal directories and surfaced to
Admin as `BLOCKED BY BUSINESS DATA` identity conflicts.

## Marketplace eligibility

| Condition | Database source | Admin reason/checklist | Controlled proof |
|---|---|---|---|
| Valid Provider identity | roles + providers/profile ownership | Pass/fail condition | PASS |
| Active, non-vacation account | providers + profiles | Account status and reason | PASS |
| Verified Provider | providers.is_verified | Verification status and direct Admin link | PASS |
| Approved Provider service | provider_services.status | Affected Service and approval reason | PASS |
| Active Customer-visible service | services | Service status and direct catalog link | PASS |
| Valid bounded price | provider override/base price + service min/max | Effective price and allowed range | PASS |
| Mandatory requirements | service_requirements + fulfillments | Completion reason | PASS |
| Approved evidence | fulfillments | Evidence reason and Service review link | PASS |
| Active zone/service/provider coverage | zones + zone_services + zone_providers | Coverage reason and Zones link | PASS |
| Customer address in zone | addresses + polygon/radius resolution | Address-specific RPC decision | PASS |
| Valid availability | availability_rules | Availability reason and Provider schedule link | PASS |
| No blocking state | incidents + account state | Operational reason and Operations link | PASS |

`marketplace_eligibility_internal` is the single private database pipeline used by
Customer search, safe Provider details, the Admin checklist, Provider profile status,
and the booking-insert guard. The controlled Provider starts hidden; Admin approves
evidence, verification, service, coverage, and availability through real UI; the
Customer then sees and opens the Provider. Suspension hides it, unsuspension restores
it, and every state is checked after refresh and directly in the database.

## Security and data exposure

| Assertion | Result |
|---|---|
| Anon cannot execute private eligibility/checklist functions | PASS |
| Customer cannot execute Admin/Provider checklist or verification RPCs | PASS |
| Provider cannot execute Customer marketplace search | PASS |
| Customer cannot select raw Provider rows or private Provider documents | PASS |
| Customer receives only the safe marketplace RPC projection | PASS |
| Historical booking Provider links resolve through the safe details RPC | PASS |
| Ineligible Customer booking insert is rejected by the database (`23514`) | PASS |
| SECURITY DEFINER functions validate identity, use fixed `search_path`, and have explicit grants | PASS |
| No service-role key is present in browser source | PASS |

The trusted service role remains able to create operational/QA fixtures; Customer
inserts are role-validated and eligibility-gated. No anon or authenticated browser
grant was added for the trigger or internal eligibility function.

## QA, persistence, and cleanup

`provider-eligibility.spec.ts` and `role-exclusivity.spec.ts` use browser UI, real
Supabase mutations, database postconditions, refresh persistence, and unexpected
console/request/response/transport failure capture. No success response is mocked.
Cleanup is idempotent. Temporary evidence, coverage, availability, requirements, and
Provider-service rows are removed. Audited QA bookings that cannot be hard-deleted
are cancelled and their uniquely tagged QA services are inactive; no active or
globally influential QA state remains.

## Migrations

- `20260719020000_patch2_identity_marketplace.sql`
- `20260719021000_patch2_provider_read_policy.sql`
- `20260719022000_patch2_marketplace_return_types.sql`
- `20260719023000_patch2_safe_provider_reads.sql`
- `20260719024000_patch2_booking_service_role.sql`

All are additive and applied to the linked Supabase project. RLS was tightened for
Customer Provider reads; no existing migration was edited.

