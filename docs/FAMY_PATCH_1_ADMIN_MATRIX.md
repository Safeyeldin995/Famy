# Famy Patch 1 — Admin Runtime Matrix

Verified 2026-07-19 against local runtime and Vercel Preview deployment
`dpl_9MY8D4LjWGYQKw6F9rUvVeKaoEFd`. Both gates passed 39/39 with the real
Supabase project `mjhkaiabfnzewprcnojp`. “Embedded” routes are intentional
sections of an existing Admin page, not missing pages.

## Admin reads

| Feature | Read/write | Expected behavior and route | Database/RPC | Automated test | Local | Preview | Persistence/audit/cleanup | Final |
|---|---|---|---|---|---|---|---|---|
| Overview | Read | KPIs and queues load at `/admin`; failed queue reads render an error instead of zero and retry successfully | payments, bookings, providers, profiles | `admin-reads.spec.ts`, `admin-audit-fixes.spec.ts` | PASS | PASS | Injected provider-read failure/retry PASS | PASS |
| Operations | Read | Summary and operational queues load at `/admin/operations` | `admin_operations_summary`, queue tables | `admin-reads.spec.ts` | PASS | PASS | N/A | PASS |
| Providers | Read | Search/filter provider list at `/admin/providers` | providers, profiles | `admin-reads.spec.ts`, `admin-details.spec.ts` | PASS | PASS | N/A | PASS |
| Provider Details | Read | Provider, documents, services, eligibility and availability survive refresh | provider tables, `provider_eligibility` | `admin-details.spec.ts` | PASS | PASS | Refresh PASS | PASS |
| Customers | Read | Search/filter customer aggregates at `/admin/customers` without refetch loops | profiles, bookings, payments | `admin-reads.spec.ts`, `admin-details.spec.ts` | PASS | PASS | N/A | PASS |
| Customer Details | Read | Profile, booking and payment history survive refresh | profiles, bookings, payments | `admin-details.spec.ts` | PASS | PASS | Refresh PASS | PASS |
| Bookings | Read | Search/status filtering and booking actions load at `/admin/bookings` | bookings and related records | `admin-reads.spec.ts` | PASS | PASS | N/A | PASS |
| Cancellation Reasons | Read | Search and applicable-state list loads | cancellation_reasons | `admin-reads.spec.ts` | PASS | PASS | N/A | PASS |
| Cases | Read | Support, dispute and no-show tabs load/filter | support_tickets, disputes, no_show_reports | `admin-reads.spec.ts` | PASS | PASS | N/A | PASS |
| Payments | Read | Search/status list and proof links load | payments, bookings | `admin-reads.spec.ts` | PASS | PASS | N/A | PASS |
| Payment Methods | Read | Search and ordered method list loads | payment_methods | `admin-reads.spec.ts` | PASS | PASS | N/A | PASS |
| Services | Read | Catalog search/category/status filtering loads | services, categories | `admin-reads.spec.ts` | PASS | PASS | N/A | PASS |
| Service Pricing | Read | Pricing limits and flags load in `/admin/services` | services, provider_services | `admin-catalog-controls.spec.ts` | PASS | PASS | Refresh PASS | PASS |
| Requirements & Evidence | Read | Requirements and pending evidence load in `/admin/services` | service_requirements, provider_requirement_fulfillments | `admin-remaining-mutations.spec.ts` | PASS | PASS | Refresh PASS | PASS |
| Promo Codes | Read | Search/status list loads | promo_codes and scope joins | `admin-reads.spec.ts` | PASS | PASS | N/A | PASS |
| Zones & Coverage | Read | Zones, geometry and coverage load | zones, zone_services, zone_providers | `admin-reads.spec.ts`, `admin-zones.spec.ts` | PASS | PASS | Refresh PASS | PASS |
| Campaigns | Read | Draft/scheduled/cancelled campaign list loads | notification_campaigns | `admin-reads.spec.ts` | PASS | PASS | N/A | PASS |
| Notifications | Read | Failed/dead notification queue loads in Operations | notification_outbox | `admin-remaining-mutations.spec.ts` | PASS | PASS | N/A | PASS |
| Audit Log | Read | Filters and server pagination load at `/admin/audit-log` | audit_logs | `admin-reads.spec.ts` | PASS | PASS | Immutable data retained | PASS |
| Settings | Read | Billing, categories, areas, reminders and content load | settings, categories, booking_reminder_rules | `admin-reads.spec.ts` | PASS | PASS | Refresh PASS | PASS |

`admin-reads.spec.ts` verifies successful real-backend rendering for every listed
route. It does not claim exhaustive injected loading/empty/error coverage for
every route. `admin-audit-fixes.spec.ts` separately verifies the Overview's
failed pending-provider read and retry path. No tested route produced an endless
spinner, blank screen, unexpected console error, or unexpected failed request.

## Admin writes

| Feature | Read/write | Expected behavior and route | Database/RPC | Automated test | Local | Preview | Persistence/audit/cleanup | Final |
|---|---|---|---|---|---|---|---|---|
| Create/edit Service | Write | Submit only after categories load; persisted edit | services | `admin-writes.spec.ts` | PASS | PASS | Refresh/audit/cleanup PASS | PASS |
| Activate/deactivate Service | Write | Immediate pending state and verified toggle | services | `admin-catalog-controls.spec.ts` | PASS | PASS | Refresh/audit/cleanup PASS | PASS |
| Reorder Services | Write | No service-level reorder control is advertised by the existing UI | N/A | route inspection + runtime catalog test | PASS | PASS | N/A | PASS |
| Edit Service pricing limits | Write | Limits persist and flagged prices remain visible | services | `admin-catalog-controls.spec.ts` | PASS | PASS | Refresh/audit/cleanup PASS | PASS |
| Create/edit requirement | Write | Requirement values persist | service_requirements | `admin-catalog-controls.spec.ts` | PASS | PASS | Refresh/audit/cleanup PASS | PASS |
| Activate/deactivate/reorder requirement | Write | Transactional two-row swap; missing target leaves both orders unchanged | `admin_swap_service_requirement_order` | `admin-catalog-controls.spec.ts` | PASS | PASS | Refresh/forced-failure/cleanup PASS | PASS |
| Review evidence | Write | Admin-only passed review, exactly one update audit | provider_requirement_fulfillments | `admin-remaining-mutations.spec.ts` | PASS | PASS | Refresh/audit/cleanup PASS | PASS |
| Verify/reject Provider | Write | Reason required for rejection; stored verification and active state | `admin_set_provider_verification` | `admin-provider-controls.spec.ts` | PASS | PASS | Refresh/audit/cleanup PASS | PASS |
| Approve/reject Provider-service | Write | Mandatory requirements enforced; rejection reason required | `admin_set_provider_service_status` | `admin-provider-controls.spec.ts` | PASS | PASS | Refresh/audit/cleanup PASS | PASS |
| Create/edit Payment Method | Write | Values persist | payment_methods | `admin-writes.spec.ts`, `admin-catalog-controls.spec.ts` | PASS | PASS | Refresh/audit/cleanup PASS | PASS |
| Activate/deactivate Payment Method | Write | Verified toggle | payment_methods | `admin-catalog-controls.spec.ts` | PASS | PASS | Refresh/audit/cleanup PASS | PASS |
| Set default Payment Method | Write | Exactly one default persists | `admin_set_default_payment_method` | `admin-catalog-controls.spec.ts` | PASS | PASS | Refresh/audit/cleanup PASS | PASS |
| Reorder Payment Methods | Write | Transactional two-row swap; non-Admin/missing target leaves both orders unchanged | `admin_swap_payment_method_order` | `admin-catalog-controls.spec.ts` | PASS | PASS | Refresh/forced-failure/cleanup PASS | PASS |
| Create/edit Promo Code | Write | Values and scope persist | promo_codes and scope joins | `admin-writes.spec.ts`, `admin-catalog-controls.spec.ts` | PASS | PASS | Refresh/audit/cleanup PASS | PASS |
| Activate/deactivate Promo Code | Write | Verified toggle | promo_codes | `admin-catalog-controls.spec.ts` | PASS | PASS | Refresh/audit/cleanup PASS | PASS |
| Create/edit Zone | Write | Existing polygon implementation persists geometry | zones | `admin-zones.spec.ts`, `admin-catalog-controls.spec.ts` | PASS | PASS | Refresh/audit/cleanup PASS | PASS |
| Activate/deactivate Zone | Write | Verified toggle | zones | `admin-catalog-controls.spec.ts` | PASS | PASS | Refresh/audit/cleanup PASS | PASS |
| Assign service/provider coverage | Write | Coverage checkbox updates immediately and persists | zone_services, zone_providers | `admin-catalog-controls.spec.ts` | PASS | PASS | Refresh/audit/cleanup PASS | PASS |
| Create/edit Cancellation Reason | Write | Values persist | cancellation_reasons | `admin-remaining-mutations.spec.ts` | PASS | PASS | Refresh/audit/cleanup PASS | PASS |
| Activate/deactivate Cancellation Reason | Write | Applicable active state persists | cancellation_reasons | `admin-remaining-mutations.spec.ts` | PASS | PASS | Refresh/audit/cleanup PASS | PASS |
| Reorder Cancellation Reasons | Write | Transactional two-row swap; missing target leaves both orders unchanged | `admin_swap_cancellation_reason_order` | `admin-remaining-mutations.spec.ts` | PASS | PASS | Refresh/forced-failure/cleanup PASS | PASS |
| Create Campaign | Write | Draft persists; scheduled activation and cancellation verified | notification_campaigns, campaign RPCs | `admin-writes.spec.ts` | PASS | PASS | Refresh/audit/cleanup PASS | PASS |
| Assign Support case | Write | Authenticated Admin ID persists | support_tickets | `admin-remaining-mutations.spec.ts` | PASS | PASS | Refresh/audit/cleanup PASS | PASS |
| Resolve Support case | Write | Notes required before submit; row readback verified | support_tickets | `admin-remaining-mutations.spec.ts` | PASS | PASS | Refresh/audit/cleanup PASS | PASS |
| Resolve/reject Dispute and No-show | Write | Notes required; no automatic booking/payment side effect | resolution RPCs | `admin-case-controls.spec.ts` | PASS | PASS | Refresh/audit/cleanup PASS | PASS |
| Retry failed notification | Write | One call requeues once; duplicate clicks blocked | `admin_retry_notification` | `admin-remaining-mutations.spec.ts` | PASS | PASS | Refresh/audit/cleanup PASS | PASS |
| Update Booking Status | Write | Zero-row update fails; permitted selector transition returns/read-backs one row | bookings | `admin-audit-fixes.spec.ts` | PASS | PASS | Refresh/exact Admin audit/cleanup PASS | PASS |
| Update Settings | Write | Billing, categories, areas, reminders and content persist; area failure rolls back | settings, categories, booking_reminder_rules | `admin-writes.spec.ts`, `admin-audit-fixes.spec.ts` | PASS | PASS | Exact restore/failure rollback/cleanup PASS | PASS |

## Defects and resolutions

- Silent writes trusted RPC/update completion without reading the committed row.
  Mutations now select/read back persisted state and surface real errors.
- Two-row reorder actions issued independent updates. Admin-only transactional
  RPCs now lock/validate both rows and update both orders in one statement.
- Forms and dialogs could close or report success before persistence. Success UI
  now follows verified mutation completion; pending states block duplicates.
- Customer filter changes repeated the same profiles/bookings/payments reads and
  used repeated array scans. One cached aggregate query plus indexed maps removes
  the refetch burst and quadratic client work.
- Detail and list errors could appear as blank/not-found states. Shared Admin
  error UI now exposes the database error and a retry action.
- Preview SSO testing used a project-scoped Vercel bypass value only in the test
  process and QA browser state; no bypass secret was written to the repository.

Cleanup is idempotent and was run twice after Preview. QA identities that cannot
be hard-deleted because of retained foreign-key/audit history remain suspended
and banned; QA zones remain inactive and QA bookings cancelled. Assertions found
no active booking, zone, default payment method, campaign, or pending global
restoration attributable to the QA harness.

Additive migration `20260719010000_patch1_atomic_admin_reorders.sql` was applied.
It adds only three Admin-checked swap RPCs with fixed `search_path` and explicit
authenticated grants. Existing RLS, mandatory requirement guards, immutable
audit history, and polygon-zone implementation remain intact.
