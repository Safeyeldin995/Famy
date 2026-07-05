-- Sprint 4 rebrand: update the seeded InstaPay handle from Famio to Famy branding.
-- Scope narrowed after verification: only `handle` is actually rendered to
-- customers (src/components/famio/PaymentBlock.tsx); `display_name` is fetched
-- but never rendered anywhere in the UI, so it is left untouched here rather
-- than rewritten speculatively. `note` is unrelated to the rebrand and also
-- left untouched. Uses jsonb_set (not a full object rebuild) to change only
-- the one key that matters.
-- Append-only per project convention — does not edit the original seed migration.
UPDATE public.settings
SET value = jsonb_set(value, '{handle}', '"famy@instapay"')
WHERE key = 'instapay_receiver';
