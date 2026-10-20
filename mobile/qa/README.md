# Phase 1 local verification

Run `node qa/unit.cjs` from `mobile/` for focused date, consent, phone,
rebooking, tutoring matching, and locale encoding checks.

After exporting web, run:

```powershell
node qa/phase1-web.cjs "$env:TEMP/m-web" qa/artifacts
```

This serves the export on loopback and intercepts every remote request.
Synthetic fixtures exist only in the QA harness. It does not authenticate
against, read, or mutate a live database. Artifacts are ignored by Git.

`artifacts/screenshots.json` lists absolute paths for all 22 Arabic
390x844 captures: home, search, both categories, provider, booking placeholder,
bookings, booking detail, notifications, profile, addresses, family list/add/edit,
favorites, promos, help, terms, privacy, populated favorites, empty addresses,
and address error/retry. `artifacts/verification.json` records interaction checks.

## Query parity

`src/lib/queries.ts` ports the existing web query implementations: marketplace
RPCs and exclusions, service metadata and bookability, signed avatars, bookings
and party profiles, latest payment status, addresses, favorites, notifications,
promos, family CRUD (soft removal), education taxonomy, approved tutoring
capabilities, and public settings. Source comments identify the web files.
No new backend contract or migration is required. No required query was left
unported. Native hooks use the mobile session context; category discovery also
exposes the address selection used by search. Booking writes remain Phase 2.

## Scope and limits

These are browser rendering and mocked interaction checks, not evidence of
real-device behavior or deployed RLS. Web ignores native RTL layout. Android
export verifies bundling; device navigation, native clipboard/Linking, and RTL
still need device QA. No Production access or deployment is part of this work.

The root unit suite initially timed out in a mock Firebase auth test while builds
were running concurrently. Its final unchanged run used at most two workers:
242 files passed, 4 skipped; 1,467 tests passed, 64 skipped; exit 0.
Mobile lint has zero errors and three Fast Refresh mixed-export warnings.
